import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkInfoService } from "../electron/work-info-service";
import type { AnimeResult, IdentityCandidate, WorkInfo } from "../shared/contracts";

const info = (overrides: Partial<WorkInfo> = {}): WorkInfo => ({ refs: ["anilist:1", "mal:10"], title: "Frieren", titles: { english: "Frieren" }, synonyms: [], status: "finished",
  genres: ["Fantasy"], studios: ["madhouse"], relations: [], fetchedAt: Date.now(), source: "anilist", ...overrides });
const candidate: IdentityCandidate = { refs: ["anilist:1", "mal:10"], title: "Frieren", titles: ["Frieren", "Sousou no Frieren"], type: "TV", year: 2023, episodes: 28 };
const anime: AnimeResult = { id: "aniwave:frieren-1", title: "Frieren", provider: "aniwave", sources: [{ id: "aniwave:frieren-1", provider: "aniwave", title: "Frieren", aliases: ["Frieren", "Sousou no Frieren"], type: "TV" }] };
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "work-info-")); vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(async () => { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); });

describe("WorkInfoService", () => {
  it("learns references by title search, caches information on disk, and refreshes by age", async () => {
    const search = vi.fn(async () => [candidate]), lookup = vi.fn(async () => info());
    const service = new WorkInfoService(search, lookup);
    await service.load(join(directory, "work-info.json"));
    const updates: WorkInfo[] = [];
    const first = await service.info(anime, { enabled: true }, (value) => updates.push(value));
    expect(first.refs).toEqual(["anilist:1", "mal:10"]);
    expect(first.info?.title).toBe("Frieren");
    expect(search).toHaveBeenCalledWith("Frieren");
    expect(lookup).toHaveBeenCalledWith(["anilist:1", "mal:10"]);
    await service.flush();
    expect(JSON.parse(await readFile(join(directory, "work-info.json"), "utf8")).infos).toHaveLength(1);

    // A later request with a known reference serves the cached copy without any lookup.
    const restored = new WorkInfoService(search, lookup);
    await restored.load(join(directory, "work-info.json"));
    const second = await restored.info({ ...anime, refs: ["mal:10"] }, { enabled: true }, (value) => updates.push(value));
    expect(second.info?.title).toBe("Frieren");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)?.stale).toBeUndefined();

    // A finished series is refreshed after ninety days; an airing one after a day. The cached copy shows first, marked stale.
    vi.setSystemTime(Date.now() + 91 * 86_400_000);
    lookup.mockResolvedValueOnce(info({ title: "Frieren (refreshed)" }));
    const third = await restored.info({ ...anime, refs: ["mal:10"] }, { enabled: true }, (value) => updates.push(value));
    expect(updates.at(-1)).toMatchObject({ title: "Frieren", stale: true });
    expect(third.info?.title).toBe("Frieren (refreshed)");
    lookup.mockResolvedValueOnce(info({ title: "Airing", status: "ongoing" }));
    await restored.info({ ...anime, refs: ["mal:10"] }, { enabled: true, refresh: true });
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    lookup.mockResolvedValueOnce(info({ title: "Airing later", status: "ongoing" }));
    expect((await restored.info({ ...anime, refs: ["mal:10"] }, { enabled: true })).info?.title).toBe("Airing later");
    expect(lookup).toHaveBeenCalledTimes(4);
  });

  it("serves cached information when the service is off or failing and reports the failure", async () => {
    const lookup = vi.fn(async () => info());
    const service = new WorkInfoService(vi.fn(async () => []), lookup);
    await service.load(join(directory, "work-info.json"));
    expect(await service.info({ ...anime, refs: ["mal:10"] }, { enabled: false })).toEqual({ refs: [] });
    await service.info({ ...anime, refs: ["mal:10"] }, { enabled: true });
    vi.setSystemTime(Date.now() + 100 * 86_400_000);
    lookup.mockRejectedValueOnce(new Error("offline"));
    const result = await service.info({ ...anime, refs: ["mal:10"] }, { enabled: true });
    expect(result.info).toMatchObject({ title: "Frieren", stale: true, error: "offline" });
    expect((await service.info({ ...anime, refs: ["mal:10"] }, { enabled: false })).info?.title).toBe("Frieren");
    expect(await service.info(anime, { enabled: false })).toEqual({ refs: [] });
  });

  it("caches search candidates for a day and returns none on failure", async () => {
    const search = vi.fn(async () => [candidate]);
    const service = new WorkInfoService(search, vi.fn(async () => undefined));
    expect(await service.candidates("Frieren", true)).toEqual([candidate]);
    expect(await service.candidates("  frieren ", true)).toEqual([candidate]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(await service.candidates("Frieren", false)).toEqual([candidate]);
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    search.mockRejectedValueOnce(new Error("offline"));
    expect(await service.candidates("Frieren", true)).toEqual([candidate]);
    expect(await service.candidates("Other", false)).toEqual([]);
  });
});
