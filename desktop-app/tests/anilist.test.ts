import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aniListGenres, aniListStudioPage, aniListTags, browseAniList, lookupAniList, plainDescription, resetAniListRateLimit, searchAniList, toCandidate, toWorkInfo } from "../electron/anilist";

const media = {
  id: 146722, idMal: 51367, title: { romaji: "JoJo no Kimyou na Bouken: Stone Ocean Part 2", english: "JoJo's Bizarre Adventure: STONE OCEAN Part 2", native: "ジョジョの奇妙な冒険 ストーンオーシャン 2クール" },
  synonyms: ["JoJo's Bizarre Adventure Part 6 (Part 2)", ""], format: "ONA", episodes: 26, seasonYear: 2022, season: "FALL", startDate: { year: 2022 }, status: "FINISHED",
  genres: ["Action", "Adventure"], studios: { nodes: [{ name: "david production" }] }, averageScore: 82,
  description: "The legacy continues.<br><br><i>(Source: Netflix)</i>", coverImage: { extraLarge: "https://img.test/xl.jpg", large: "https://img.test/l.jpg" }, bannerImage: "https://img.test/b.jpg",
  nextAiringEpisode: null,
  relations: { edges: [{ relationType: "PREQUEL", node: { id: 131942, idMal: 48661, type: "ANIME", title: { romaji: "JoJo no Kimyou na Bouken: Stone Ocean", english: "JoJo's Bizarre Adventure: STONE OCEAN" }, format: "ONA" } },
    { relationType: "SOURCE", node: { id: 1, idMal: 2, type: "MANGA", title: { romaji: "Manga" }, format: "MANGA" } }] }
};

function response(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-ratelimit-remaining": "29", ...headers } });
}

describe("AniList client", () => {
  beforeEach(() => { resetAniListRateLimit(); vi.useFakeTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("turns media into candidates and information with both references", () => {
    expect(toCandidate(media)).toEqual({ refs: ["anilist:146722", "mal:51367"], title: "JoJo's Bizarre Adventure: STONE OCEAN Part 2",
      titles: ["JoJo no Kimyou na Bouken: Stone Ocean Part 2", "JoJo's Bizarre Adventure: STONE OCEAN Part 2", "ジョジョの奇妙な冒険 ストーンオーシャン 2クール", "JoJo's Bizarre Adventure Part 6 (Part 2)"],
      status: "finished", type: "ONA", year: 2022, episodes: 26 });
    const info = toWorkInfo(media)!;
    expect(info).toMatchObject({ refs: ["anilist:146722", "mal:51367"], type: "ONA", year: 2022, season: "fall", status: "finished", genres: ["Action", "Adventure"], studios: ["david production"], score: 82,
      description: "The legacy continues.\n\n(Source: Netflix)", cover: "https://img.test/xl.jpg", banner: "https://img.test/b.jpg", source: "anilist" });
    expect(info.relations).toEqual([{ relation: "prequel", refs: ["anilist:131942", "mal:48661"], title: "JoJo's Bizarre Adventure: STONE OCEAN", type: "ONA" }]);
    expect(info.synonyms).toEqual(["JoJo's Bizarre Adventure Part 6 (Part 2)"]);
    expect(plainDescription("a &amp; b<br/>c")).toBe("a & b\nc");
    expect(toCandidate({ id: 5 })).toBeUndefined();
  });

  it("searches by term and looks up by MyAnimeList id, honouring the rate limit headers", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data: { Page: { media: [media] } } }))
      .mockResolvedValueOnce(response({ data: { Media: media } }, { "x-ratelimit-remaining": "1", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 30) }))
      .mockResolvedValueOnce(response({ data: { Media: null }, errors: [{ message: "Not Found.", status: 404 }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await searchAniList("stone ocean part 2")).map((candidate) => candidate.refs)).toEqual([["anilist:146722", "mal:51367"]]);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).variables).toEqual({ search: "stone ocean part 2" });
    expect((await lookupAniList(["mal:51367"]))?.title).toBe("JoJo's Bizarre Adventure: STONE OCEAN Part 2");
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).variables).toEqual({ idMal: 51367 });
    // The second response left one request before the limit, so the next call waits for the stated reset.
    const pending = lookupAniList(["anilist:99"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string).variables).toEqual({ id: 99 });
  });

  it("treats 429 as a network pause and other failures as errors", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(response({}, { "retry-after": "120" }, 429)).mockResolvedValueOnce(response({ errors: [{ message: "bad query" }] }, {}, 200)));
    await expect(searchAniList("x")).rejects.toMatchObject({ name: "CatalogNetworkError", retryAfterMs: 120_000 });
    resetAniListRateLimit();
    await expect(searchAniList("y")).rejects.toThrow(/bad query/);
    expect(await lookupAniList(["kitsu:1"])).toBeUndefined();
  });

  it("loads one filtered browse page and does not mistake missing rate headers for exhaustion", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { GenreCollection: ["Drama", "Hentai", "Action"] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: true }, media: [media] } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await aniListGenres()).toEqual(["Action", "Drama"]);
    const query = { page: 2, filters: { includeGenres: ["Action", "Adventure"], excludeGenres: ["Horror"], minimumScore: 70, minimumEpisodes: 12, maximumEpisodes: 30, sort: "popularity" as const } };
    const result = await browseAniList(query);
    expect(result.hasNextPage).toBe(true);
    expect(result.entries[0]).toMatchObject({ anilistId: 146722, title: "JoJo's Bizarre Adventure: STONE OCEAN Part 2", genres: ["Action", "Adventure"], episodes: 26 });
    const sent = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(sent.variables).toMatchObject({ page: 2, genres: ["Action", "Adventure"], excluded: ["Horror"], score: 69, minEpisodes: 11, maxEpisodes: 31 });
    expect(sent.variables.startedAfter).toBeUndefined();
    // Cards need no relations, banner or airing data; the series screen looks the work up itself.
    expect(sent.query).not.toMatch(/relations|bannerImage|nextAiringEpisode/);
  });

  it("keeps undated and unreleased titles out of the newest sort unless a status is chosen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 20, 12));
    const page = () => new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => page());
    vi.stubGlobal("fetch", fetchMock);
    const variables = (call: number) => JSON.parse(fetchMock.mock.calls[call][1]!.body as string).variables;
    await browseAniList({ page: 1, filters: { includeGenres: [], excludeGenres: [], sort: "newest" } });
    expect(variables(0)).toMatchObject({ sort: ["START_DATE_DESC"], startedAfter: 10_000_000, startedBefore: 20260921 });
    await browseAniList({ page: 1, filters: { includeGenres: [], excludeGenres: [], sort: "newest", status: "upcoming" } });
    expect(variables(1)).toMatchObject({ status: "NOT_YET_RELEASED", startedAfter: 10_000_000 });
    expect(variables(1).startedBefore).toBeUndefined();
  });

  it("sends a title search with tags and studio ids, and reads matching studios from the same request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: [media] },
      matching: { studios: [{ id: 7285, name: "Toei", isAnimationStudio: false }, { id: 18, name: "Toei Animation", isAnimationStudio: true }] } } }), { status: 200 }))
      .mockImplementation(async () => new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const sent = (call: number) => JSON.parse(fetchMock.mock.calls[call][1]!.body as string);
    const result = await browseAniList({ page: 1, filters: { includeGenres: [], excludeGenres: [], search: "toei", tags: ["Isekai"], sort: "match" } });
    expect(result.studios).toEqual([{ id: 18, name: "Toei Animation", animation: true }, { id: 7285, name: "Toei", animation: false }]);
    expect(sent(0).variables).toMatchObject({ search: "toei", tags: ["Isekai"], sort: ["SEARCH_MATCH"] });
    expect(sent(0).query).toContain("studios(search: $search");
    const studio = { id: 18, name: "Toei Animation", animation: true };
    const within = await browseAniList({ page: 1, filters: { includeGenres: [], excludeGenres: [], studio, search: "piece", sort: "match" } }, [21, 22]);
    expect(within.studios).toBeUndefined();
    expect(sent(1).variables).toMatchObject({ ids: [21, 22], search: "piece" });
    expect(sent(1).query).not.toContain("studios(search");
    expect(await browseAniList({ page: 1, filters: { includeGenres: [], excludeGenres: [], studio, sort: "popularity" } }, [])).toEqual({ entries: [], hasNextPage: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lists non-adult tags and reads a studio page as anime ids, with card details on the first page only", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { MediaTagCollection: [{ name: "Time Travel", isAdult: false }, { name: "Nakadashi", isAdult: true }, { name: "Isekai", isAdult: false }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { Studio: { media: { pageInfo: { hasNextPage: true }, nodes: [{ ...media, type: "ANIME", isAdult: false }, { id: 5, type: "MANGA", isAdult: false }, { id: 6, type: "ANIME", isAdult: true }] } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { Studio: { media: { pageInfo: { hasNextPage: false }, nodes: [{ id: 9, type: "ANIME", isAdult: false }] } } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await aniListTags()).toEqual(["Isekai", "Time Travel"]);
    const first = await aniListStudioPage({ id: 569, name: "MAPPA", animation: true }, 1);
    expect(first).toMatchObject({ ids: [146722], hasNextPage: true }); expect(first.entries[0].anilistId).toBe(146722);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).variables).toEqual({ id: 569, page: 1, main: true });
    const producer = await aniListStudioPage({ id: 141, name: "Toei Video", animation: false }, 2);
    expect(producer).toEqual({ ids: [9], entries: [], hasNextPage: false });
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string).variables.main).toBeUndefined();
  });
});
