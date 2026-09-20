import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateBrowseIdentity, validateBrowseQuery, validateKnownCandidate } from "../electron/browse-validation";
import { BrowseService } from "../electron/browse-service";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("browse validation", () => {
  it("accepts advanced filters and normalizes duplicate genres", () => {
    expect(validateBrowseQuery({ page: 3, filters: { includeGenres: ["Action", "action"], excludeGenres: ["Horror"], year: 2026,
      season: "spring", status: "ongoing", format: "TV", minimumScore: 70, minimumEpisodes: 12, maximumEpisodes: 24, sort: "score" } })).toEqual({
      page: 3, filters: { includeGenres: ["Action"], excludeGenres: ["Horror"], year: 2026, season: "spring", status: "ongoing", format: "TV", minimumScore: 70, minimumEpisodes: 12, maximumEpisodes: 24, sort: "score" }
    });
  });

  it("rejects conflicting genres and malformed ranges", () => {
    expect(() => validateBrowseQuery({ page: 1, filters: { includeGenres: ["Action"], excludeGenres: ["action"], sort: "title" } })).toThrow(/cannot be included/);
    expect(() => validateBrowseQuery({ page: 1, filters: { includeGenres: [], excludeGenres: [], minimumEpisodes: 24, maximumEpisodes: 12, sort: "title" } })).toThrow(/episode range/);
    expect(() => validateBrowseQuery({ page: 0, filters: { includeGenres: [], excludeGenres: [], sort: "title" } })).toThrow(/Invalid browse filter/);
  });
});

describe("browse search validation", () => {
  it("normalizes a term, tags, and a studio, and drops a best-match sort that has no term", () => {
    expect(validateBrowseQuery({ page: 1, filters: { includeGenres: [], excludeGenres: [], search: "  attack   on titan ", tags: ["Isekai", "isekai"], studio: { id: 569, name: " MAPPA ", animation: true, extra: 1 }, sort: "match" } }).filters)
      .toEqual({ includeGenres: [], excludeGenres: [], search: "attack on titan", tags: ["Isekai"], studio: { id: 569, name: "MAPPA", animation: true }, sort: "match" });
    expect(validateBrowseQuery({ page: 1, filters: { includeGenres: [], excludeGenres: [], search: "a", sort: "match" } }).filters).toEqual({ includeGenres: [], excludeGenres: [], sort: "popularity" });
  });
  it("rejects an oversized term, malformed tags, and a studio without an id", () => {
    const base = { includeGenres: [], excludeGenres: [], sort: "popularity" };
    expect(() => validateBrowseQuery({ page: 1, filters: { ...base, search: "x".repeat(121) } })).toThrow(/Invalid browse search/);
    expect(() => validateBrowseQuery({ page: 1, filters: { ...base, tags: [""] } })).toThrow(/Invalid browse tags/);
    expect(() => validateBrowseQuery({ page: 1, filters: { ...base, studio: { name: "MAPPA" } } })).toThrow(/Invalid browse studio/);
  });
});

describe("known work validation", () => {
  it("accepts old browse identities and preserves validated title roles in new ones", () => {
    const entry = { refs: ["anilist:42"], title: "Pick", titles: ["Pick"] };
    expect(validateBrowseIdentity(entry)).toEqual(entry);
    expect(validateBrowseIdentity({ ...entry, titleVariants: { english: " Pick ", romaji: "Romaji", native: "原題", ignored: "value" } }))
      .toEqual({ ...entry, titles: ["Pick", "Romaji", "原題"], titleVariants: { english: "Pick", romaji: "Romaji", native: "原題" } });
    for (const value of [undefined, { ...entry, refs: ["anilist:42", "anilist:43"] }, { ...entry, titleVariants: [] },
      { ...entry, titleVariants: { romaji: 42 } }, { ...entry, titleVariants: { native: "x".repeat(501) } }]) {
      expect(() => validateBrowseIdentity(value)).toThrow(/Invalid browse/);
    }
  });
  it("passes nothing through as nothing and normalizes an identified work", () => {
    expect(validateKnownCandidate(undefined)).toBeUndefined();
    expect(validateKnownCandidate(null)).toBeUndefined();
    expect(validateKnownCandidate({ refs: ["anilist:42", "anilist:42", "mal:7"], title: " Pick ", titles: ["Pick", "Other"], type: "tv", year: 2026, episodes: 12, status: "ongoing", cover: "ignored" }))
      .toEqual({ refs: ["anilist:42", "mal:7"], title: "Pick", titles: ["Pick", "Other"], type: "TV", year: 2026, episodes: 12, status: "ongoing" });
  });
  it("rejects a work without references, with malformed references, or with oversized titles", () => {
    for (const value of ["text", { refs: [], title: "Pick" }, { refs: ["imdb:1"], title: "Pick" }, { refs: ["anilist:42"], title: "" }, { refs: ["anilist:42"], title: "Pick", titles: ["x".repeat(501)] }]) {
      expect(() => validateKnownCandidate(value)).toThrow(/Invalid known work/);
    }
  });
});

describe("browse cache", () => {
  it("discards old pages that were filtered after pagination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ani-browse-")); directories.push(directory);
    const query = validateBrowseQuery({ page: 1, filters: { includeGenres: ["Action", "Drama"], excludeGenres: [], sort: "popularity" } });
    const path = join(directory, "browse.json");
    await writeFile(path, JSON.stringify({ version: 1, pages: [[JSON.stringify(query), { query, entries: [], hasNextPage: true, fetchedAt: Date.now() }]] }));
    const fetchPage = vi.fn().mockResolvedValue({ entries: [], hasNextPage: false });
    const service = new BrowseService(fetchPage);
    await service.load(path);
    expect((await service.browse(query)).hasNextPage).toBe(false);
    expect(fetchPage).toHaveBeenCalledOnce();
  });
  it("reuses a fresh page and retains it as stale when refreshing fails", async () => {
    let now = 10_000;
    const query = validateBrowseQuery({ page: 1, filters: { includeGenres: [], excludeGenres: [], sort: "popularity" } });
    const fetchPage = vi.fn().mockResolvedValueOnce({ entries: [], hasNextPage: true }).mockRejectedValueOnce(new Error("offline"));
    const service = new BrowseService(fetchPage, vi.fn().mockResolvedValue(["Action"]), () => now);
    const directory = await mkdtemp(join(tmpdir(), "ani-browse-")); directories.push(directory);
    await service.load(join(directory, "browse.json"));
    expect(await service.browse(query)).toMatchObject({ hasNextPage: true, fetchedAt: now });
    expect(await service.browse(query)).toMatchObject({ cached: true, stale: false });
    expect(fetchPage).toHaveBeenCalledOnce();
    now += 31 * 60_000;
    expect(await service.browse(query)).toMatchObject({ cached: true, stale: true, error: "Could not load the AniList catalog" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
  it("reads a studio's works once, reports progress, and hands the ids to the catalog query", async () => {
    vi.useFakeTimers();
    const studio = { id: 569, name: "MAPPA", animation: true };
    const query = validateBrowseQuery({ page: 1, filters: { includeGenres: ["Action"], excludeGenres: [], studio, sort: "score" } });
    const popular = { anilistId: 1, refs: ["anilist:1"], title: "Popular", titles: ["Popular"], genres: [], status: "finished" as const, studios: [] };
    const studioPage = vi.fn(async (_studio: unknown, page: number) => page === 1 ? { ids: [1, 2], entries: [popular], hasNextPage: true } : { ids: [2, 3], entries: [], hasNextPage: false });
    const fetchPage = vi.fn().mockResolvedValue({ entries: [], hasNextPage: false });
    const service = new BrowseService(fetchPage, vi.fn(), Date.now, { tags: vi.fn(), studioPage });
    const update = vi.fn();
    const first = service.browse(query, update);
    await vi.runAllTimersAsync(); await first;
    expect(update).toHaveBeenCalledExactlyOnceWith({ studio: "MAPPA", read: 2, entries: [popular] });
    expect(fetchPage).toHaveBeenCalledWith(query, [1, 2, 3]);
    const second = service.browse({ ...query, page: 2 });
    await vi.runAllTimersAsync(); await second;
    expect(studioPage).toHaveBeenCalledTimes(2);
  });
  it("resumes an interrupted studio list from the page that failed", async () => {
    vi.useFakeTimers();
    const studio = { id: 18, name: "Toei Animation", animation: true };
    const query = validateBrowseQuery({ page: 1, filters: { includeGenres: [], excludeGenres: [], studio, sort: "popularity" } });
    const studioPage = vi.fn().mockResolvedValueOnce({ ids: [1], entries: [], hasNextPage: true }).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ids: [2], entries: [], hasNextPage: false });
    const fetchPage = vi.fn().mockResolvedValue({ entries: [], hasNextPage: false });
    const service = new BrowseService(fetchPage, vi.fn(), Date.now, { tags: vi.fn(), studioPage });
    const failed = service.browse(query).catch((reason: Error) => reason.message);
    await vi.runAllTimersAsync();
    expect(await failed).toBe("Could not load the AniList catalog");
    const retried = service.browse(query);
    await vi.runAllTimersAsync(); await retried;
    expect(studioPage.mock.calls.map((call) => call[1])).toEqual([1, 2, 2]);
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(query, [1, 2]);
  });
});
