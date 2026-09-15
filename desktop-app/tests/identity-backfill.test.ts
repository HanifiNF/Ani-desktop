import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillLibraryIdentity } from "../electron/identity-backfill";
import { StateStore } from "../electron/state";
import { WorkInfoService } from "../electron/work-info-service";
import type { IdentityCandidate, LibraryEntry, WorkInfo } from "../shared/contracts";

const entry = (animeId: string, title: string): LibraryEntry => ({ animeId, title, lastEpisode: "1", mode: "sub", updatedAt: new Date().toISOString() });
const candidate: IdentityCandidate = { refs: ["anilist:1", "mal:10"], title: "Frieren", titles: ["Frieren"], type: "TV" };
const info: WorkInfo = { refs: ["anilist:1", "mal:10"], title: "Frieren", titles: {}, synonyms: [], status: "finished", genres: [], studios: [], relations: [], fetchedAt: Date.now(), source: "anilist", type: "TV", year: 2023 };
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "backfill-")); });
afterEach(() => rm(directory, { recursive: true, force: true }));

describe("library identity backfill", () => {
  it("gives entries without references their ids and skips ones that already have them", async () => {
    const store = new StateStore(join(directory, "state.json"));
    await store.load();
    await store.recordHistory(entry("aniwave:frieren-1", "Frieren"));
    await store.toggleBookmark(entry("aniwave:known-2", "Known"));
    await store.bindWork({ ids: ["aniwave:known-2"], refs: ["mal:99"] });
    await store.recordHistory(entry("aniwave:unknown-3", "Nothing Like It"));
    const search = vi.fn(async (term: string) => term === "Frieren" ? [candidate] : []);
    const service = new WorkInfoService(search, vi.fn(async () => info));
    expect(await backfillLibraryIdentity(store, service, new AbortController().signal, 0)).toBe(1);
    expect(store.workOf("aniwave:frieren-1")).toMatchObject({ refs: ["anilist:1", "mal:10"], type: "TV", year: 2023 });
    expect(search.mock.calls.map((call) => call[0])).toEqual(["Frieren", "Nothing Like It"]);
    await store.saveSettings({ ...store.snapshot().settings, animeInfo: false });
    expect(await backfillLibraryIdentity(store, service, new AbortController().signal, 0)).toBe(0);
  });
});
