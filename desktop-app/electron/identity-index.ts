import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import * as zlib from "node:zlib";
import type { IdentityCandidate, IdentityIndexStatus, MediaType } from "../shared/contracts";
import { mediaTypeOf, normalizedTitle, positiveInteger, ref, titleKeys, unique } from "../shared/identity";

/*
 * A local copy of the anime-offline-database (manami-project) trimmed to what identity needs: titles, synonyms,
 * type, year, episode count, and the ids the big metadata sites use for the same anime. With it installed, search
 * groups provider records by canonical identity without asking any service, and it refreshes weekly.
 */

export const INDEX_URL = "https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json.zst";
const WEEK = 7 * 24 * 60 * 60_000;
const MAX_SYNONYMS = 15;
const MAX_DOWNLOAD = 200 * 1024 * 1024;

/** One dataset entry, compacted for the on-disk index. */
export interface IndexEntry { t: string; s: string[]; y?: MediaType; e?: number; r?: number; refs: string[]; }

const zstdDecompress = promisify((zlib as unknown as { zstdDecompress: (buffer: Buffer, callback: (error: Error | null, result: Buffer) => void) => void }).zstdDecompress);
const SOURCE_HOSTS: Record<string, "mal" | "anilist" | "anidb" | "kitsu"> = { "myanimelist.net": "mal", "anilist.co": "anilist", "anidb.net": "anidb", "kitsu.app": "kitsu", "kitsu.io": "kitsu" };

export function refFromSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const namespace = SOURCE_HOSTS[url.hostname.replace(/^www\./, "")];
    const id = url.pathname.match(/\/anime\/(\d+)/)?.[1];
    return namespace && id ? ref(namespace, id) : undefined;
  } catch { return undefined; }
}

/** Trim a dataset to entries that carry a MyAnimeList or AniList id, keeping only what matching needs. */
export function compactDataset(dataset: unknown): IndexEntry[] {
  const rows = dataset && typeof dataset === "object" && Array.isArray((dataset as { data?: unknown }).data) ? (dataset as { data: unknown[] }).data : [];
  const entries: IndexEntry[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const refs = unique((Array.isArray(row.sources) ? row.sources : []).map(refFromSourceUrl).filter((value): value is string => Boolean(value)));
    if (!refs.some((value) => value.startsWith("mal:") || value.startsWith("anilist:"))) continue;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) continue;
    const synonyms = (Array.isArray(row.synonyms) ? row.synonyms : []).filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 200)
      .map((value) => value.trim()).filter((value) => value !== title).slice(0, MAX_SYNONYMS);
    const type = mediaTypeOf(row.type), episodes = positiveInteger(row.episodes);
    const year = positiveInteger((row.animeSeason as Record<string, unknown> | undefined)?.year);
    entries.push({ t: title, s: synonyms, refs, ...(type ? { y: type } : {}), ...(episodes ? { e: episodes } : {}), ...(year ? { r: year } : {}) });
  }
  return entries;
}

export const toCandidate = (entry: IndexEntry): IdentityCandidate => ({
  refs: entry.refs, title: entry.t, titles: [entry.t, ...entry.s], ...(entry.y ? { type: entry.y } : {}), ...(entry.r ? { year: entry.r } : {}), ...(entry.e ? { episodes: entry.e } : {})
});

export class IdentityIndex {
  private entries: IndexEntry[] = [];
  private byKey = new Map<string, number[]>();
  private updatedAt?: number;
  private updating?: Promise<IdentityIndexStatus>;
  private error?: string;

  constructor(private readonly path: string, private readonly download: (url: string, signal: AbortSignal) => Promise<Response> = (url, signal) => fetch(url, { signal, headers: { "User-Agent": "ANIdesktop" } })) {}

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.entries)) return;
      this.install(data.entries.filter((entry: IndexEntry) => entry && typeof entry.t === "string" && Array.isArray(entry.refs) && Array.isArray(entry.s)), typeof data.updatedAt === "number" ? data.updatedAt : (await stat(this.path)).mtimeMs);
    } catch { /* No index yet, or a damaged one: search works without it until the next update. */ }
  }

  private install(entries: IndexEntry[], updatedAt: number): void {
    this.entries = entries;
    this.updatedAt = updatedAt;
    this.byKey = new Map();
    entries.forEach((entry, index) => {
      for (const key of titleKeys({ title: entry.t, aliases: entry.s })) {
        const list = this.byKey.get(key);
        if (list) { if (!list.includes(index)) list.push(index); } else this.byKey.set(key, [index]);
      }
    });
  }

  status(enabled: boolean): IdentityIndexStatus {
    return { enabled, entries: this.entries.length, updatedAt: this.updatedAt, updating: Boolean(this.updating), ...(this.error ? { error: this.error } : {}) };
  }

  get size(): number { return this.entries.length; }
  needsUpdate(): boolean { return !this.updatedAt || Date.now() - this.updatedAt >= WEEK; }

  /** Works the index names for any of these titles, most specific keys first, at most a handful. */
  candidatesFor(titles: string[]): IdentityCandidate[] {
    if (!this.entries.length) return [];
    const indexes = new Set<number>();
    for (const title of titles) {
      for (const key of titleKeys({ title })) for (const index of this.byKey.get(key) ?? []) indexes.add(index);
      if (indexes.size > 40) break;
    }
    return [...indexes].slice(0, 40).map((index) => toCandidate(this.entries[index]));
  }

  /** Candidates for a whole search: entries naming any result title, plus entries whose title contains the query. */
  candidatesForSearch(query: string, resultTitles: string[]): IdentityCandidate[] {
    const direct = this.candidatesFor(resultTitles);
    if (direct.length || !this.entries.length) return direct;
    const needle = normalizedTitle(query);
    if (needle.length < 3) return [];
    const found: IdentityCandidate[] = [];
    for (const [key, indexes] of this.byKey) {
      if (!key.includes(needle)) continue;
      for (const index of indexes) found.push(toCandidate(this.entries[index]));
      if (found.length >= 40) break;
    }
    return found;
  }

  /** Download, decompress, trim, and install the latest dataset. Concurrent calls share one run. */
  update(signal: AbortSignal = new AbortController().signal): Promise<IdentityIndexStatus> {
    if (this.updating) return this.updating;
    this.updating = (async () => {
      try {
        const response = await this.download(INDEX_URL, AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]));
        if (!response.ok) throw new Error(`Index download failed (${response.status})`);
        const compressed = Buffer.from(await response.arrayBuffer());
        if (compressed.byteLength > MAX_DOWNLOAD) throw new Error("Index download is unexpectedly large");
        const json = INDEX_URL.endsWith(".zst") ? (await zstdDecompress(compressed)).toString("utf8") : compressed.toString("utf8");
        const entries = compactDataset(JSON.parse(json));
        if (entries.length < 1000) throw new Error("Index download held too few entries");
        const updatedAt = Date.now();
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(`${this.path}.new`, JSON.stringify({ version: 1, updatedAt, entries }), "utf8");
        await rename(`${this.path}.new`, this.path);
        this.install(entries, updatedAt);
        this.error = undefined;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.updating = undefined;
      }
      return this.status(true);
    })();
    return this.updating;
  }
}
