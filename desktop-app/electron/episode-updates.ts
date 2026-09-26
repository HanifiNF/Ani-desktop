import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Episode, EpisodeUpdate, EpisodeUpdateStatus, LibraryEntry, Settings } from "../shared/contracts";
import { animeSources, enabledProviders } from "../shared/catalog";
import { catalogScope } from "../shared/settings";

const INTERVAL = 6 * 60 * 60_000;
const between = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Observation = { numbers: string[]; count: number };

export class EpisodeUpdates {
  private observations = new Map<string, Observation>();
  private updates: EpisodeUpdate[] = [];
  private latestByAnime: Record<string, number> = {};
  private counts: Record<string, number> = {};
  private checkedAt?: number;
  private checking = false;
  private error?: string;
  private running?: Promise<EpisodeUpdateStatus>;
  private generation = 0;
  private writes = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly cached: (sourceId: string, settings: Settings) => Episode[] | undefined,
    private readonly fetch: (sourceId: string, settings: Settings) => Promise<Episode[]>,
    private readonly publish: (status: EpisodeUpdateStatus) => void,
    private readonly notify: (updates: EpisodeUpdate[]) => void,
    private readonly pause: (ms: number) => Promise<void> = between
  ) {}

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8"));
      if (data.version !== 1) return;
      if (data.observations && typeof data.observations === "object") for (const [key, value] of Object.entries(data.observations)) {
        const row = value as Observation;
        if (key.length <= 8192 && Array.isArray(row?.numbers) && row.numbers.length <= 5000 && row.numbers.every((n) => typeof n === "string" && /^\d+(?:\.\d+)?$/.test(n)) && Number.isSafeInteger(row.count)) this.observations.set(key, row);
      }
      if (Array.isArray(data.updates)) this.updates = data.updates.filter((row: EpisodeUpdate) => row && typeof row.id === "string" && typeof row.animeId === "string" && typeof row.sourceId === "string" && typeof row.episodeId === "string" && typeof row.episodeNumber === "string" && typeof row.title === "string" && Number.isFinite(row.detectedAt) && Number.isFinite(new Date(row.detectedAt).getTime())).slice(0, 200)
        .map((row: EpisodeUpdate) => ({ ...row, readAt: typeof row.readAt === "number" && Number.isFinite(row.readAt) && row.readAt >= row.detectedAt ? row.readAt : undefined }));
      if (data.latestByAnime && typeof data.latestByAnime === "object") for (const [key, value] of Object.entries(data.latestByAnime)) if (key.length <= 512 && typeof value === "number" && Number.isFinite(value)) this.latestByAnime[key] = value;
      if (typeof data.checkedAt === "number" && Number.isFinite(data.checkedAt)) this.checkedAt = data.checkedAt;
    } catch { /* A damaged derived update file starts fresh. */ }
  }

  private key(sourceId: string, settings: Settings): string { return `${catalogScope(settings)}:${sourceId}`; }

  snapshot(settings: Settings): EpisodeUpdateStatus {
    const scope = `${catalogScope(settings)}:`;
    return { updates: [...this.updates], unreadCount: this.updates.filter((item) => !item.readAt).length, counts: Object.fromEntries(Object.entries(this.counts).filter(([key]) => key.startsWith(scope)).map(([key, count]) => [key.slice(scope.length), count])),
      latestByAnime: { ...this.latestByAnime }, checking: this.checking, checkedAt: this.checkedAt, error: this.error };
  }

  private changed(settings: Settings): void { this.publish(this.snapshot(settings)); }

  private persist(): Promise<void> {
    const body = JSON.stringify({ version: 1, observations: Object.fromEntries(this.observations), updates: this.updates, latestByAnime: this.latestByAnime, checkedAt: this.checkedAt });
    this.writes = this.writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.new`, body, "utf8");
      await rename(`${this.path}.new`, this.path);
    });
    return this.writes;
  }

  seed(entries: LibraryEntry[], settings: Settings): void {
    let seeded = false;
    for (const entry of entries) for (const source of animeSources(entry)) {
      const key = this.key(source.id, settings);
      const episodes = this.cached(source.id, settings);
      const observed = this.observations.get(key);
      if (observed) this.counts[key] = observed.count;
      else if (episodes) this.counts[key] = episodes.length;
      if (this.observations.has(key)) continue;
      if (episodes) {
        this.observations.set(key, { numbers: [...new Set(episodes.map((episode) => episode.number))], count: episodes.length });
        seeded = true;
      }
    }
    if (seeded) void this.persist().catch(() => undefined);
    this.changed(settings);
  }

  async observe(entry: LibraryEntry, sourceId: string, episodes: Episode[], settings: Settings): Promise<EpisodeUpdate[]> {
    if (!animeSources(entry).some((source) => source.id === sourceId)) return [];
    const key = this.key(sourceId, settings);
    const previous = this.observations.get(key);
    const numbers = [...new Set(episodes.map((episode) => episode.number))];
    const additions = previous ? episodes.filter((episode) => !previous.numbers.includes(episode.number)) : [];
    const now = Date.now();
    const created: EpisodeUpdate[] = additions.map((episode) => ({ id: `${key}:${episode.number}`, animeId: entry.animeId, title: entry.title,
      sourceId, provider: episode.provider, episodeId: episode.id, episodeNumber: episode.number, detectedAt: now }));
    this.observations.set(key, { numbers: [...new Set([...(previous?.numbers ?? []), ...numbers])], count: episodes.length });
    this.counts[key] = episodes.length;
    if (created.length) {
      const known = new Set(this.updates.map((item) => item.id));
      this.updates = [...created.filter((item) => !known.has(item.id)), ...this.updates].slice(0, 200);
      this.latestByAnime[entry.animeId] = now;
    }
    await this.persist();
    this.changed(settings);
    return created;
  }

  check(entries: LibraryEntry[], settings: Settings, force = false): Promise<EpisodeUpdateStatus> {
    if (this.running) return this.running;
    if (!force && this.checkedAt && Date.now() - this.checkedAt < INTERVAL) return Promise.resolve(this.snapshot(settings));
    this.running = this.perform(entries, settings).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async perform(entries: LibraryEntry[], settings: Settings): Promise<EpisodeUpdateStatus> {
    const generation = this.generation;
    this.checking = true; this.error = undefined; this.changed(settings);
    const enabled = new Set(enabledProviders(settings));
    const seen = new Set<string>();
    const fresh: EpisodeUpdate[] = [];
    let failures = 0, attempted = 0;
    for (const entry of entries) for (const source of animeSources(entry)) {
      if (generation !== this.generation) break;
      if (!enabled.has(source.provider) || seen.has(source.id)) continue;
      seen.add(source.id);
      if (attempted++ > 0) await this.pause(2000);
      try {
        const episodes = await this.fetch(source.id, settings);
        if (generation !== this.generation) break;
        fresh.push(...await this.observe(entry, source.id, episodes, settings));
      }
      catch { failures += 1; }
    }
    if (generation !== this.generation) { this.checking = false; this.changed(settings); return this.snapshot(settings); }
    this.checkedAt = Date.now(); this.checking = false;
    if (failures) this.error = `${failures} ${failures === 1 ? "source" : "sources"} could not be checked. Try again later.`;
    await this.persist(); this.changed(settings);
    if (fresh.length && settings.desktopEpisodeNotifications !== false) this.notify(fresh);
    return this.snapshot(settings);
  }

  async dismiss(id: string | undefined, settings: Settings): Promise<EpisodeUpdateStatus> {
    this.updates = id ? this.updates.filter((item) => item.id !== id) : [];
    await this.persist(); this.changed(settings);
    return this.snapshot(settings);
  }

  async markRead(id: string | undefined, settings: Settings): Promise<EpisodeUpdateStatus> {
    const now = Date.now();
    this.updates = this.updates.map((item) => (!id || item.id === id) && !item.readAt ? { ...item, readAt: now } : item);
    await this.persist(); this.changed(settings);
    return this.snapshot(settings);
  }

  async prune(entries: LibraryEntry[], settings: Settings): Promise<void> {
    this.generation += 1;
    this.checkedAt = undefined;
    const saved = new Set(entries.map((entry) => entry.animeId));
    this.updates = this.updates.filter((item) => saved.has(item.animeId));
    this.latestByAnime = Object.fromEntries(Object.entries(this.latestByAnime).filter(([id]) => saved.has(id)));
    // Retain provider baselines only while a saved title still refers to them.
    const keys = new Set(entries.flatMap((entry) => animeSources(entry).map((source) => this.key(source.id, settings))));
    for (const key of this.observations.keys()) if (!keys.has(key)) { this.observations.delete(key); delete this.counts[key]; }
    await this.persist(); this.changed(settings);
  }

  async resetSourceScope(entries: LibraryEntry[], settings: Settings): Promise<void> {
    this.generation += 1;
    this.observations.clear(); this.counts = {}; this.updates = []; this.latestByAnime = {};
    this.checkedAt = undefined;
    await this.persist();
    this.seed(entries, settings);
  }

  flush(): Promise<void> { return this.writes; }
}
