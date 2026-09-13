import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeriesMetadataService } from "../electron/series-metadata-service";
import { getProviderSeriesMetadata } from "../electron/scraper";
import type { AnimeResult, ProviderSeriesMetadata } from "../shared/contracts";

vi.mock("../electron/scraper", () => ({ getProviderSeriesMetadata: vi.fn() }));
const config = { preferredProvider: "auto" as const, aniwaveBaseUrl: "https://a.test", anidbBaseUrl: "https://b.test", hianimeBaseUrl: "https://c.test" };
const source = (provider: "aniwave" | "anidb" | "hianime") => ({ id: `${provider}:show-1`, provider, title: "Show", aliases: ["Show"] });
const anime: AnimeResult = { ...source("aniwave"), sources: [source("aniwave"), source("hianime")] };
const value = (provider: "aniwave" | "anidb" | "hianime", genres: string[], availableEpisodes?: number, announcedEpisodes?: number): ProviderSeriesMetadata =>
  ({ sourceId: `${provider}:show-1`, provider, genres, availableEpisodes, announcedEpisodes, checkedAt: Date.now() });

beforeEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("series metadata catalog", () => {
  it("combines genres, keeps counts provider-specific, and uses a cached episode count", async () => {
    vi.mocked(getProviderSeriesMetadata).mockImplementation(async (id) => id.startsWith("aniwave")
      ? value("aniwave", ["Fantasy", "Drama"], 12, 14) : value("hianime", ["fantasy", "冒険"], 11));
    const service = new SeriesMetadataService((id) => id.startsWith("aniwave") ? 11 : undefined);
    const result = await service.metadata(anime, config);
    expect(result.genres).toEqual(["Drama", "Fantasy", "冒険"]);
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "aniwave", availableEpisodes: 11, announcedEpisodes: 14 }),
      expect.objectContaining({ provider: "hianime", availableEpisodes: 11, announcedEpisodes: undefined })
    ]));
  });

  it("preserves stale metadata when one provider later fails and omits disabled sources", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T00:00:00Z"));
    vi.mocked(getProviderSeriesMetadata).mockImplementation(async (id) => id.startsWith("aniwave")
      ? value("aniwave", ["Drama"], 11, 14) : value("hianime", ["Fantasy"], 11));
    const service = new SeriesMetadataService();
    await service.metadata(anime, config);
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
    vi.mocked(getProviderSeriesMetadata).mockImplementation(async (id) => {
      if (id.startsWith("aniwave")) throw new Error("offline");
      return value("hianime", ["Fantasy"], 11);
    });
    const stale = await service.metadata(anime, config);
    expect(stale.sources.find((item) => item.provider === "aniwave")).toMatchObject({ availableEpisodes: 11, announcedEpisodes: 14, stale: true, error: "offline" });
    const enabled = await new SeriesMetadataService().metadata(anime, { ...config, disabledSources: ["hianime"] });
    expect(enabled.sources.map((item) => item.provider)).toEqual(["aniwave"]);
  });

  it("still gets the available count when a provider's detail metadata is unavailable", async () => {
    vi.mocked(getProviderSeriesMetadata).mockRejectedValue(new Error("detail offline"));
    const service = new SeriesMetadataService(() => undefined, async () => 11);
    const result = await service.metadata({ ...anime, sources: [source("aniwave")] }, config);
    expect(result.sources[0]).toMatchObject({ provider: "aniwave", availableEpisodes: 11, error: "detail offline" });
    expect(result.sources[0].announcedEpisodes).toBeUndefined();
  });
});
