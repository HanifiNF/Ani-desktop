import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnimeResult, IdentityCandidate, WorkInfo } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import { bestCandidate, factsOfAll, isRef, normalizedTitle, refsOf, unique } from "../shared/identity";
import { catalogContext } from "./catalog-requests";
import { lookupAniList, searchAniList } from "./anilist";

const DAY = 24 * 60 * 60_000;
/** Static facts change rarely; an airing series changes weekly. */
const STATIC_REFRESH = 90 * DAY;
const AIRING_REFRESH = DAY;
const SEARCH_RETENTION = DAY;
const INFO_LIMIT = 5000;
const SEARCH_LIMIT = 500;

export interface InfoOptions {
  enabled: boolean;
  refresh?: boolean;
  /** References the library depends on; never evicted. */
  protectedRefs?: () => Set<string>;
}
export interface InfoResult { info?: WorkInfo; /** References learned for the anime during this request, to remember on its work. */ refs: string[]; }

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export const anchorOf = (refs: string[]): string | undefined => refs.find((value) => value.startsWith("mal:")) ?? refs.find(isRef);

/** Series information and search candidates from a metadata service, kept on disk indefinitely and refreshed by age. */
export class WorkInfoService {
  private infos = new Map<string, WorkInfo>();
  /** Every known reference of a work points at the anchor its information is stored under. */
  private aliases = new Map<string, string>();
  private searches = new Map<string, { at: number; candidates: IdentityCandidate[] }>();
  private cachePath?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private writes = Promise.resolve();
  private dirty = false;

  constructor(
    private readonly search: (term: string) => Promise<IdentityCandidate[]> = searchAniList,
    private readonly lookup: (refs: string[]) => Promise<WorkInfo | undefined> = lookupAniList
  ) {}

  async load(path: string): Promise<void> {
    this.cachePath = path;
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (data.version !== 1) return;
      for (const row of Array.isArray(data.infos) ? data.infos.slice(-INFO_LIMIT) : []) {
        if (!Array.isArray(row) || !isRef(row[0]) || !row[1] || typeof row[1] !== "object") continue;
        const info = row[1] as WorkInfo;
        if (!Array.isArray(info.refs) || !info.refs.every(isRef) || typeof info.title !== "string" || typeof info.fetchedAt !== "number" || info.fetchedAt > Date.now()) continue;
        this.infos.set(row[0], { ...info, stale: undefined, error: undefined });
        for (const value of info.refs) this.aliases.set(value, row[0]);
      }
      for (const row of Array.isArray(data.searches) ? data.searches.slice(-SEARCH_LIMIT) : []) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1]?.at !== "number" || Date.now() - row[1].at >= SEARCH_RETENTION || !Array.isArray(row[1].candidates)) continue;
        this.searches.set(row[0], { at: row[1].at, candidates: row[1].candidates.filter((candidate: IdentityCandidate) => candidate && Array.isArray(candidate.refs) && candidate.refs.every(isRef) && Array.isArray(candidate.titles)) });
      }
    } catch { /* Derived information is fetched again if the cache is absent or damaged. */ }
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.cachePath && !this.timer) this.timer = setTimeout(() => { void this.flush(); }, 250);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const path = this.cachePath;
    if (path && this.dirty) {
      this.dirty = false;
      const body = JSON.stringify({ version: 1, infos: [...this.infos], searches: [...this.searches] });
      this.writes = this.writes.then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.new`, body, "utf8");
        await rename(`${path}.new`, path);
      }).catch(() => { this.dirty = true; });
    }
    await this.writes;
  }

  /** Candidate works for a search term, from the day-long cache or the service. Failures yield no candidates. */
  async candidates(term: string, enabled: boolean): Promise<IdentityCandidate[]> {
    const key = normalizedTitle(term);
    if (!key) return [];
    const cached = this.searches.get(key);
    if (cached && Date.now() - cached.at < SEARCH_RETENTION) return cached.candidates;
    if (!enabled) return cached?.candidates ?? [];
    try {
      const candidates = await this.search(term);
      this.searches.delete(key); this.searches.set(key, { at: Date.now(), candidates });
      while (this.searches.size > SEARCH_LIMIT) this.searches.delete(this.searches.keys().next().value!);
      this.scheduleFlush();
      return candidates;
    } catch (error) {
      if (catalogContext.getStore()?.signal.aborted) throw error;
      return cached?.candidates ?? [];
    }
  }

  cached(refs: string[]): WorkInfo | undefined {
    for (const value of refs) {
      const anchor = this.aliases.get(value) ?? value;
      const info = this.infos.get(anchor);
      if (info) return info;
    }
    return undefined;
  }

  private needsRefresh(info: WorkInfo, force?: boolean): boolean {
    if (force) return true;
    const age = Date.now() - info.fetchedAt;
    return age >= STATIC_REFRESH || ((info.status === "ongoing" || info.status === "upcoming") && age >= AIRING_REFRESH);
  }

  private remember(info: WorkInfo, protectedRefs?: () => Set<string>): WorkInfo {
    const anchor = anchorOf(info.refs) ?? info.refs[0];
    this.infos.delete(anchor); this.infos.set(anchor, info);
    for (const value of info.refs) this.aliases.set(value, anchor);
    if (this.infos.size > INFO_LIMIT) {
      const keep = protectedRefs?.() ?? new Set<string>();
      for (const key of this.infos.keys()) {
        if (this.infos.size <= INFO_LIMIT) break;
        const candidate = this.infos.get(key)!;
        if (key === anchor || candidate.refs.some((value) => keep.has(value))) continue;
        this.infos.delete(key);
        for (const value of candidate.refs) this.aliases.delete(value);
      }
    }
    this.scheduleFlush();
    return info;
  }

  /**
   * Information for an anime: the cached copy first, then a refresh when it is old enough or asked for.
   * An anime without references is searched by its titles; a single confident candidate supplies them.
   */
  async info(anime: AnimeResult, options: InfoOptions, update?: (info: WorkInfo) => void): Promise<InfoResult> {
    const sources = animeSources(anime);
    let refs = refsOf(anime);
    const learned: string[] = [];
    if (!refs.length && options.enabled) {
      const titles = unique([anime.title, ...sources.flatMap((source) => [source.title, ...source.aliases])].map((value) => value.trim()).filter(Boolean)).slice(0, 3);
      for (const title of titles) {
        const candidates = await this.candidates(title, true);
        catalogContext.getStore()?.signal.throwIfAborted();
        const match = bestCandidate({ title: anime.title, aliases: sources.flatMap((source) => [source.title, ...source.aliases]), ...factsOfAll(sources) }, candidates);
        if (match) { refs = match.refs; learned.push(...match.refs); break; }
      }
    }
    if (!refs.length) return { refs: learned };
    const cached = this.cached(refs);
    const refresh = !cached || this.needsRefresh(cached, options.refresh);
    if (cached) update?.({ ...cached, stale: refresh || undefined });
    if (cached && !refresh) return { info: cached, refs: learned };
    if (!options.enabled) return { info: cached, refs: learned };
    try {
      const fetched = await this.lookup(refs);
      catalogContext.getStore()?.signal.throwIfAborted();
      if (!fetched) return { info: cached, refs: learned };
      const merged: WorkInfo = { ...fetched, refs: unique([...fetched.refs, ...refs]) };
      learned.push(...merged.refs);
      return { info: this.remember(merged, options.protectedRefs), refs: unique(learned) };
    } catch (error) {
      if (catalogContext.getStore()?.signal.aborted) throw error;
      if (!cached) throw error;
      return { info: { ...cached, stale: true, error: message(error) }, refs: learned };
    }
  }

  get size(): number { return this.infos.size; }
}
