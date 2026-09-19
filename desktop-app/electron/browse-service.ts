import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowseQuery, BrowseResult } from "../shared/contracts";
import { aniListGenres, browseAniList } from "./anilist";
import { catalogContext, CatalogNetworkError } from "./catalog-requests";

const FRESH = 30 * 60_000, RETAIN = 7 * 24 * 60 * 60_000, GENRES_FRESH = 7 * 24 * 60 * 60_000, MAX_PAGES = 100, GAP = 2_000;
interface SavedBrowse { version: 3; genres?: { values: string[]; at: number }; pages: [string, BrowseResult][]; }
const keyOf = (query: BrowseQuery) => JSON.stringify(query);
const safeMessage = (reason: unknown) => reason instanceof CatalogNetworkError ? reason.message : "Could not load the AniList catalog";

export class BrowseService {
  private pages = new Map<string, BrowseResult>();
  private genres?: { values: string[]; at: number };
  private path?: string;
  private writes = Promise.resolve();
  private active = Promise.resolve();
  private lastNetworkAt = 0;
  constructor(private readonly fetchPage = browseAniList, private readonly fetchGenres = aniListGenres, private readonly now: () => number = Date.now) {}

  async load(path: string): Promise<void> {
    this.path = path;
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as SavedBrowse;
      // Version 1 paginated by the first genre before filtering the other genres locally. Version 2 listed an adult-only genre that browse can never fill.
      if (data.version !== 3 || !Array.isArray(data.pages)) return;
      if (data.genres && Array.isArray(data.genres.values) && Number.isFinite(data.genres.at)) this.genres = data.genres;
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

  async browse(query: BrowseQuery): Promise<BrowseResult> {
    const key = keyOf(query), cached = this.pages.get(key), now = this.now();
    if (!catalogContext.getStore()?.refresh && cached && now - cached.fetchedAt < FRESH) return { ...cached, cached: true, stale: false, error: undefined };
    try {
      const result = await this.oneAtATime(() => this.fetchPage(query));
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
    const body = JSON.stringify({ version: 3, genres: this.genres, pages: [...this.pages] } satisfies SavedBrowse), path = this.path;
    this.writes = this.writes.catch(() => undefined).then(async () => { await mkdir(dirname(path), { recursive: true }); await writeFile(`${path}.new`, body, "utf8"); await rename(`${path}.new`, path); });
    return this.writes;
  }
  async flush(): Promise<void> { await this.writes; }
}
