import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowseProgress, BrowseQuery, BrowseResult, BrowseStudio } from "../shared/contracts";
import { aniListGenres, aniListStudioPage, aniListTags, browseAniList } from "./anilist";
import { catalogContext, CatalogNetworkError } from "./catalog-requests";

const FRESH = 30 * 60_000, RETAIN = 7 * 24 * 60 * 60_000, GENRES_FRESH = 7 * 24 * 60 * 60_000, MAX_PAGES = 100, GAP = 2_000, MAX_STUDIOS = 40, MAX_STUDIO_PAGES = 60;
interface Vocabulary { values: string[]; at: number }
interface StudioWorks { ids: number[]; at: number }
interface SavedBrowse { version: 4; genres?: Vocabulary; tags?: Vocabulary; studios?: [number, StudioWorks][]; pages: [string, BrowseResult][]; }
const remote = { tags: aniListTags, studioPage: aniListStudioPage };
const keyOf = (query: BrowseQuery) => JSON.stringify(query);
const safeMessage = (reason: unknown) => reason instanceof CatalogNetworkError ? reason.message : "Could not load the AniList catalog";

export class BrowseService {
  private pages = new Map<string, BrowseResult>();
  private genres?: Vocabulary;
  private tags?: Vocabulary;
  private studios = new Map<number, StudioWorks>();
  // A list interrupted halfway (the user moved on, the rate limit hit) resumes where it stopped.
  private partial = new Map<number, { ids: number[]; next: number }>();
  private path?: string;
  private writes = Promise.resolve();
  private active = Promise.resolve();
  private lastNetworkAt = 0;
  constructor(private readonly fetchPage = browseAniList, private readonly fetchGenres = aniListGenres, private readonly now: () => number = Date.now, private readonly source = remote) {}

  async load(path: string): Promise<void> {
    this.path = path;
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as SavedBrowse;
      // Version 1 paginated by the first genre before filtering the other genres locally. Version 2 listed an adult-only genre that browse can never fill. Version 3 predates search, tags, and studios.
      if (data.version !== 4 || !Array.isArray(data.pages)) return;
      const vocabulary = (value?: Vocabulary) => value && Array.isArray(value.values) && Number.isFinite(value.at) ? value : undefined;
      this.genres = vocabulary(data.genres); this.tags = vocabulary(data.tags);
      for (const [id, works] of Array.isArray(data.studios) ? data.studios : []) if (Number.isInteger(id) && Array.isArray(works?.ids) && Number.isFinite(works.at)) this.studios.set(id, works);
      for (const [key, value] of data.pages.slice(-MAX_PAGES)) {
        if (typeof key === "string" && value && Number.isFinite(value.fetchedAt) && this.now() - value.fetchedAt <= RETAIN) this.pages.set(key, value);
      }
    } catch { /* A derived cache can be rebuilt. */ }
  }

  async genreOptions(): Promise<string[]> {
    if (this.genres && this.now() - this.genres.at < GENRES_FRESH) return this.genres.values;
    try {
      const values = await this.oneAtATime(() => this.fetchGenres());
      this.genres = { values, at: this.now() }; await this.save().catch(() => undefined); return values;
    } catch (reason) {
      if (this.genres) return this.genres.values;
      throw reason;
    }
  }

  async tagOptions(): Promise<string[]> {
    if (this.tags && this.now() - this.tags.at < GENRES_FRESH) return this.tags.values;
    try {
      const values = await this.oneAtATime(() => this.source.tags());
      this.tags = { values, at: this.now() }; await this.save().catch(() => undefined); return values;
    } catch (reason) {
      if (this.tags) return this.tags.values;
      throw reason;
    }
  }

  /** Every anime a studio is credited with, as ids the catalog query can take. Read once a week, a page at a time. */
  private async worksOf(studio: BrowseStudio, update?: (progress: BrowseProgress) => void): Promise<number[]> {
    const known = this.studios.get(studio.id);
    if (known && this.now() - known.at < GENRES_FRESH) return known.ids;
    const progress = this.partial.get(studio.id) ?? { ids: [], next: 1 };
    this.partial.set(studio.id, progress);
    try {
      while (progress.next <= MAX_STUDIO_PAGES) {
        const page = await this.oneAtATime(() => this.source.studioPage(studio, progress.next));
        progress.ids = [...new Set([...progress.ids, ...page.ids])]; progress.next += 1;
        if (!page.hasNextPage) break;
        update?.({ studio: studio.name, read: progress.ids.length, ...(page.entries.length ? { entries: page.entries } : {}) });
      }
    } catch (reason) {
      // An older list still answers while AniList cannot be reached.
      if (known && !catalogContext.getStore()?.signal.aborted) return known.ids;
      throw reason;
    }
    this.partial.delete(studio.id);
    this.studios.delete(studio.id); this.studios.set(studio.id, { ids: progress.ids, at: this.now() });
    while (this.studios.size > MAX_STUDIOS) this.studios.delete(this.studios.keys().next().value!);
    return progress.ids;
  }

  async browse(query: BrowseQuery, update?: (progress: BrowseProgress) => void): Promise<BrowseResult> {
    const key = keyOf(query), cached = this.pages.get(key), now = this.now();
    if (!catalogContext.getStore()?.refresh && cached && now - cached.fetchedAt < FRESH) return { ...cached, cached: true, stale: false, error: undefined };
    try {
      const ids = query.filters.studio ? await this.worksOf(query.filters.studio, update) : undefined;
      const result = await this.oneAtATime(() => this.fetchPage(query, ids));
      const value: BrowseResult = { query, ...result, fetchedAt: this.now() };
      this.pages.delete(key); this.pages.set(key, value); this.trim(); await this.save().catch(() => undefined); return value;
    } catch (reason) {
      const error = safeMessage(reason);
      const retryAfter = reason instanceof CatalogNetworkError ? reason.retryAfterMs : 0;
      if (cached && now - cached.fetchedAt <= RETAIN) return { ...cached, cached: true, stale: true, error, ...(retryAfter ? { retryAt: now + retryAfter } : {}) };
      throw new Error(error);
    }
  }

  private oneAtATime<T>(operation: () => Promise<T>): Promise<T> {
    const run = async () => {
      const context = catalogContext.getStore();
      const wait = Math.max(0, this.lastNetworkAt + GAP - this.now());
      if (wait) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        context?.signal.addEventListener("abort", () => { clearTimeout(timer); reject(context.signal.reason); }, { once: true });
      });
      context?.signal.throwIfAborted();
      this.lastNetworkAt = this.now();
      return operation();
    };
    const result = this.active.then(run, run);
    this.active = result.then(() => undefined, () => undefined);
    return result;
  }

  private trim() { while (this.pages.size > MAX_PAGES) this.pages.delete(this.pages.keys().next().value!); }
  private save(): Promise<void> {
    if (!this.path) return Promise.resolve();
    const body = JSON.stringify({ version: 4, genres: this.genres, tags: this.tags, studios: [...this.studios], pages: [...this.pages] } satisfies SavedBrowse), path = this.path;
    this.writes = this.writes.catch(() => undefined).then(async () => { await mkdir(dirname(path), { recursive: true }); await writeFile(`${path}.new`, body, "utf8"); await rename(`${path}.new`, path); });
    return this.writes;
  }
  async flush(): Promise<void> { await this.writes; }
}
