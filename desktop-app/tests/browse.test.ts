import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateBrowseQuery } from "../electron/browse-validation";
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

describe("browse cache", () => {
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
});
