import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnimeResult, ProviderSeriesMetadata, SeriesMetadataCatalog } from "../shared/contracts";
import { animeSources, enabledProviders, isProviderName } from "../shared/catalog";
import { catalogScope } from "../shared/settings";
import { catalogContext } from "./catalog-requests";
import { getProviderSeriesMetadata, type SourceConfig } from "./scraper";

const DAY = 24 * 60 * 60_000;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function genresOf(sources: ProviderSeriesMetadata[]): string[] {
  const values = new Map<string, string>();
  for (const genre of sources.flatMap((source) => source.genres)) {
    const clean = genre.trim();
    const key = clean.toLocaleLowerCase();
    if (clean && clean.length <= 80 && !values.has(key)) values.set(key, clean);
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export class SeriesMetadataService {
  private cache = new Map<string, ProviderSeriesMetadata>();
  private cachePath?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private writes = Promise.resolve();
  private dirty = false;
  private readonly freshFor = DAY;
  private readonly retention = 30 * DAY;

  constructor(
    private readonly cachedEpisodeCount: (sourceId: string, config: SourceConfig) => number | undefined,
    private readonly loadEpisodeCount: (sourceId: string, config: SourceConfig) => Promise<number | undefined>
  ) {}

  async load(path: string): Promise<void> {
    this.cachePath = path;
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.entries)) return;
      for (const row of data.entries.slice(-1000)) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || row[0].length > 8192) continue;
        const value = row[1] as ProviderSeriesMetadata;
        if (!value || typeof value.sourceId !== "string" || value.sourceId.length > 512 || !isProviderName(value.provider)
          || !Array.isArray(value.genres) || value.genres.length > 100 || value.genres.some((genre) => typeof genre !== "string" || genre.length > 80)
          || typeof value.checkedAt !== "number" || value.checkedAt > Date.now() || Date.now() - value.checkedAt >= this.retention) continue;
        const count = (input: unknown) => typeof input === "number" && Number.isSafeInteger(input) && input > 0 ? input : undefined;
        // Availability is restored from the complete episode cache, never from old metadata previews.
        this.cache.set(row[0], { sourceId: value.sourceId, provider: value.provider, genres: value.genres,
          availableEpisodes: undefined, announcedEpisodes: count(value.announcedEpisodes), checkedAt: value.checkedAt });
      }
    } catch { /* Derived metadata is rebuilt if its cache is absent or damaged. */ }
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
      const body = JSON.stringify({ version: 1, entries: [...this.cache].slice(-1000) });
      this.writes = this.writes.then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.new`, body, "utf8");
        await rename(`${path}.new`, path);
      }).catch(() => { this.dirty = true; });
    }
    await this.writes;
  }

  async metadata(anime: AnimeResult, config: SourceConfig, update?: (value: SeriesMetadataCatalog) => void): Promise<SeriesMetadataCatalog> {
    const enabled = enabledProviders(config);
    const sources = animeSources(anime).filter((source, index, all) => enabled.includes(source.provider) && all.findIndex((item) => item.id === source.id) === index);
    const values = new Map<string, ProviderSeriesMetadata>();
    const snapshot = (): SeriesMetadataCatalog => {
      const rows = sources.flatMap((source) => values.has(source.id) ? [values.get(source.id)!] : []);
      return { sources: rows, genres: genresOf(rows) };
    };
    const scope = catalogScope(config);
    const refresh = catalogContext.getStore()?.refresh === true;
    for (const source of sources) {
      const cached = this.cache.get(`${scope}:${source.id}`);
      if (cached) {
        const availableEpisodes = this.cachedEpisodeCount(source.id, config) ?? cached.availableEpisodes;
        values.set(source.id, { ...cached, availableEpisodes, stale: Date.now() - cached.checkedAt >= this.freshFor || undefined });
      }
    }
    if (values.size) update?.(snapshot());
    await Promise.all(sources.map(async (source) => {
      const key = `${scope}:${source.id}`;
      const cached = this.cache.get(key);
      let countAttempted = false;
      let details = cached;
      try {
        const fetched = !refresh && cached && Date.now() - cached.checkedAt < this.freshFor
          ? cached : await getProviderSeriesMetadata(source.id, config);
        // Provider metadata may contain a preview or a planned total. Only the episode loader proves availability.
        details = { ...fetched, availableEpisodes: undefined };
        catalogContext.getStore()?.signal.throwIfAborted();
        let availableEpisodes = refresh ? undefined : this.cachedEpisodeCount(source.id, config);
        if (availableEpisodes === undefined) { countAttempted = true; availableEpisodes = await this.loadEpisodeCount(source.id, config); }
        catalogContext.getStore()?.signal.throwIfAborted();
        const value = { ...details, availableEpisodes };
        this.cache.delete(key); this.cache.set(key, value); this.scheduleFlush();
        values.set(source.id, value);
      } catch (error) {
        if (catalogContext.getStore()?.signal.aborted) throw error;
        const prior = values.get(source.id);
        let availableEpisodes = this.cachedEpisodeCount(source.id, config) ?? prior?.availableEpisodes;
        if (availableEpisodes === undefined && !countAttempted) {
          try { availableEpisodes = await this.loadEpisodeCount(source.id, config); }
          catch { /* Keep the metadata error; both independent lookups were unavailable. */ }
        }
        catalogContext.getStore()?.signal.throwIfAborted();
        values.set(source.id, prior || details ? { ...(prior ?? details!), availableEpisodes, stale: true, error: message(error) }
          : { sourceId: source.id, provider: source.provider, genres: [], availableEpisodes, checkedAt: Date.now(), error: message(error) });
      }
      update?.(snapshot());
    }));
    catalogContext.getStore()?.signal.throwIfAborted();
    return snapshot();
  }
}
