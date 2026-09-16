import { afterEach, describe, expect, it, vi } from "vitest";
import type { Episode, ProviderName } from "../shared/contracts";
import { PROVIDER_NAMES } from "../shared/catalog";
import { getProviderEpisodes } from "../electron/scraper";
import { CatalogService } from "../electron/catalog-service";
import { SeriesMetadataService } from "../electron/series-metadata-service";
import { collectEpisodePages } from "../electron/episode-loader";
import { catalogContext } from "../electron/catalog-requests";

const config = { preferredProvider: "auto" as const, aniwaveBaseUrl: "https://a.test", anidbBaseUrl: "https://b.test", hianimeBaseUrl: "https://c.test" };
const internalId = "6a8ecf9e6b1a2ef8b3306460";
const raw = (number: number) => ({ episodeNumber: number, slug: `show-episode-${number}-abc` });
const json = (body: unknown) => new Response(JSON.stringify(body));
const source = (provider: ProviderName) => ({ id: `${provider}:show-42`, provider, title: "Show", aliases: ["Show"] });
const hiFetch = (total: number | string | undefined, range: (start: number, end: number) => unknown = (start, end) => ({ episodes: Array.from({ length: end - start + 1 }, (_, i) => raw(start + i)) })) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/anime/show-42") return json({ anime: { _id: internalId, totalEpisodes: total, genres: ["Action"], episodes: [raw(1)] } });
    if (url.pathname === `/api/episodes/${internalId}`) return json(range(Number(url.searchParams.get("start")), Number(url.searchParams.get("end"))));
    throw new Error(`Unexpected request: ${url}`);
  });
afterEach(() => vi.unstubAllGlobals());

describe("complete provider episode catalogs", () => {
  it.each(PROVIDER_NAMES)("loads every returned %s episode through the shared collector", async (provider) => {
    vi.stubGlobal("fetch", provider === "hianime" ? hiFetch(3) : vi.fn(async () => json(provider === "aniwave"
      ? { result: '<a data-num="3"></a><a data-num="1"></a><a data-num="2"></a>' }
      : { data: { episodes: [{ id: 3, number: 3 }, { id: 1, number: 1 }, { id: 2, number: 2 }] } })));
    const service = new CatalogService();
    const catalog = await service.episodes(source(provider), config);
    expect(catalog.groups[0].episodes.map(e => e.number)).toEqual(["1", "2", "3"]);
    expect(await service.availableEpisodeCount(source(provider).id, config)).toBe(3);
    const counts = new CatalogService();
    const metadata = new SeriesMetadataService((id, config) => counts.cachedEpisodeCount(id, config), (id, config) => counts.availableEpisodeCount(id, config));
    expect((await metadata.metadata(source(provider), config)).sources[0].availableEpisodes).toBe(3);
  });

  it("loads all 220 episodes across three ranges instead of the embedded preview", async () => {
    const fetch = hiFetch("220"); vi.stubGlobal("fetch", fetch);
    const episodes = await getProviderEpisodes(source("hianime").id, config);
    expect(episodes.map(e => e.number)).toEqual(Array.from({ length: 220 }, (_, i) => String(i + 1)));
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://animehot.cc/api/anime/show-42",
      `https://animehot.cc/api/episodes/${internalId}?start=1&end=100`,
      `https://animehot.cc/api/episodes/${internalId}?start=101&end=200`,
      `https://animehot.cc/api/episodes/${internalId}?start=201&end=220`
    ]);
  });

  it("sorts and deduplicates overlapping range results", async () => {
    vi.stubGlobal("fetch", hiFetch(102, start => ({ episodes: start === 1 ? [raw(100), raw(1)] : [raw(102), raw(100), raw(101)] })));
    expect((await getProviderEpisodes(source("hianime").id, config)).map(e => e.number)).toEqual(["1", "100", "101", "102"]);
  });

  it("walks unknown totals until an empty range, including after a sparse range", async () => {
    const fetch = hiFetch(undefined, start => ({ episodes: start === 1 ? [raw(1)] : start === 101 ? [raw(101)] : [] }));
    vi.stubGlobal("fetch", fetch);
    expect((await getProviderEpisodes(source("hianime").id, config)).map(e => e.number)).toEqual(["1", "101"]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([{}, { episodes: [raw(1), {}] }])("rejects malformed ranges without caching a successful prefix (%j)", async (badPage) => {
    vi.stubGlobal("fetch", hiFetch(120, start => start === 1 ? { episodes: [raw(1)] } : badPage));
    const service = new CatalogService();
    const result = await service.episodes(source("hianime"), config);
    expect(result.groups[0]).toMatchObject({ episodes: [], error: expect.stringContaining("HiAnime episode range") });
    expect(service.cachedEpisodeCount(source("hianime").id, config)).toBeUndefined();
  });

  it("preserves a complete cached list when a later range fails", async () => {
    vi.stubGlobal("fetch", hiFetch(120));
    const service = new CatalogService();
    await service.episodes(source("hianime"), config);
    vi.stubGlobal("fetch", hiFetch(120, start => {
      if (start > 100) throw new Error("Range unavailable");
      return { episodes: [raw(1)] };
    }));
    const result = await service.episodes(source("hianime"), config);
    expect(result.groups[0].episodes).toHaveLength(120);
    expect(result.groups[0].error).toBe("Range unavailable");
    expect(service.cachedEpisodeCount(source("hianime").id, config)).toBe(120);
  });

  it("stops pagination on cancellation and leaves the count uncached", async () => {
    const controller = new AbortController();
    const fetch = hiFetch(220, () => { controller.abort(); return { episodes: [raw(1)] }; });
    vi.stubGlobal("fetch", fetch);
    const service = new CatalogService();
    await expect(catalogContext.run({ signal: controller.signal, scope: "cancel-pagination", priority: 2 },
      () => service.availableEpisodeCount(source("hianime").id, config))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(service.cachedEpisodeCount(source("hianime").id, config)).toBeUndefined();
  });

  it("gets metadata availability from the full list, even while only the preview is embedded", async () => {
    vi.stubGlobal("fetch", hiFetch(28));
    const catalog = new CatalogService();
    const metadata = new SeriesMetadataService((id, config) => catalog.cachedEpisodeCount(id, config), (id, config) => catalog.availableEpisodeCount(id, config));
    const result = await metadata.metadata(source("hianime"), config);
    expect(result.sources[0]).toMatchObject({ availableEpisodes: 28, genres: ["Action"] });
    expect(catalog.cachedEpisodeCount(source("hianime").id, config)).toBe(28);
  });

  it("counts an empty completed catalog as zero", async () => {
    vi.stubGlobal("fetch", hiFetch(12, () => ({ episodes: [] })));
    expect(await new CatalogService().availableEpisodeCount(source("hianime").id, config)).toBe(0);
  });

  it("refreshes the complete list and count when metadata is manually refreshed", async () => {
    const catalog = new CatalogService();
    const metadata = new SeriesMetadataService((id, config) => catalog.cachedEpisodeCount(id, config), (id, config) => catalog.availableEpisodeCount(id, config));
    vi.stubGlobal("fetch", hiFetch(3));
    await metadata.metadata(source("hianime"), config);
    vi.stubGlobal("fetch", hiFetch(4));
    const result = await catalogContext.run({ signal: new AbortController().signal, scope: "refresh-count", priority: 2, refresh: true }, () => metadata.metadata(source("hianime"), config));
    expect(result.sources[0].availableEpisodes).toBe(4);
  });

  it("reports a count failure instead of displaying the embedded preview as availability", async () => {
    vi.stubGlobal("fetch", hiFetch(28, () => { throw new Error("Episode ranges offline"); }));
    const catalog = new CatalogService();
    const metadata = new SeriesMetadataService((id, config) => catalog.cachedEpisodeCount(id, config), (id, config) => catalog.availableEpisodeCount(id, config));
    const result = await metadata.metadata(source("hianime"), config);
    expect(result.sources[0]).toMatchObject({ genres: ["Action"], error: "Episode ranges offline" });
    expect(result.sources[0].availableEpisodes).toBeUndefined();
  });
});

describe("episode loader contract for every provider", () => {
  it.each(PROVIDER_NAMES)("propagates a later %s page failure", async provider => {
    async function* pages(): AsyncGenerator<Episode[]> {
      yield [{ id: `${provider}:ep-1`, provider, number: "1" }];
      throw new Error("Second page failed");
    }
    await expect(collectEpisodePages(provider, pages())).rejects.toThrow("Second page failed");
  });
});
