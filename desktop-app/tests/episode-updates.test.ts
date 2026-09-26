import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EpisodeUpdates } from "../electron/episode-updates";
import { DEFAULT_STATE } from "../shared/settings";
import type { Episode, LibraryEntry } from "../shared/contracts";

const settings = DEFAULT_STATE.settings;
const entry: LibraryEntry = { animeId: "aniwave:show", title: "Show", lastEpisode: "12", mode: "sub", updatedAt: "2026-09-26T00:00:00Z",
  sources: [{ id: "aniwave:show", provider: "aniwave", title: "Show", aliases: ["Show"] }, { id: "hianime:show", provider: "hianime", title: "Show", aliases: ["Show"] }] };
const episodes = (provider: "aniwave" | "hianime", count: number): Episode[] => Array.from({ length: count }, (_, i) => ({ id: `${provider}:show:${i + 1}`, number: String(i + 1), provider }));

describe("saved episode updates", () => {
  it("seeds silently, detects each newly listed native episode once, and persists dismissal and ordering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "episode-updates-"));
    const path = join(directory, "updates.json");
    const notify = vi.fn();
    let count = 12;
    const make = () => new EpisodeUpdates(path, () => undefined, async (id) => episodes(id.startsWith("hianime") ? "hianime" : "aniwave", count), () => undefined, notify, async () => undefined);
    try {
      const service = make();
      await service.load();
      expect((await service.check([entry], settings, true)).updates).toHaveLength(0);
      count = 13;
      const status = await service.check([entry], settings, true);
      expect(status.counts).toMatchObject({ "aniwave:show": 13, "hianime:show": 13 });
      expect(status.updates.map((update) => update.provider)).toEqual(["hianime", "aniwave"]);
      expect(notify).toHaveBeenCalledOnce();
      expect(status.latestByAnime[entry.animeId]).toBeGreaterThan(0);
      expect(status.unreadCount).toBe(2);
      const read = await service.markRead(status.updates[0].id, settings);
      expect(read.unreadCount).toBe(1);
      expect(read.updates).toHaveLength(2);
      expect(read.updates[0].readAt).toEqual(expect.any(Number));
      await service.dismiss(status.updates[0].id, settings);
      const reopened = make();
      await reopened.load();
      expect((await reopened.check([entry], settings, true)).updates).toHaveLength(1);
      expect(notify).toHaveBeenCalledOnce();
      expect((await reopened.markRead(undefined, settings)).unreadCount).toBe(0);
      expect(reopened.snapshot(settings).updates).toHaveLength(1);
      await reopened.prune([], settings);
      expect(reopened.snapshot(settings).updates).toHaveLength(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("loads legacy notifications without readAt as unread", async () => {
    const directory = await mkdtemp(join(tmpdir(), "episode-updates-"));
    const path = join(directory, "updates.json");
    const service = new EpisodeUpdates(path, () => undefined, async () => [], () => undefined, vi.fn());
    try {
      await writeFile(path, JSON.stringify({ version: 1, updates: [{ id: "old", animeId: entry.animeId, title: entry.title, sourceId: "aniwave:show", provider: "aniwave", episodeId: "aniwave:show:13", episodeNumber: "13", detectedAt: Date.now() }] }));
      await service.load();
      expect(service.snapshot(settings).unreadCount).toBe(1);
      await service.markRead("old", settings);
      const reopened = new EpisodeUpdates(path, () => undefined, async () => [], () => undefined, vi.fn());
      await reopened.load();
      expect(reopened.snapshot(settings).unreadCount).toBe(0);
      expect(reopened.snapshot(settings).updates).toHaveLength(1);
    } finally { await service.flush(); await rm(directory, { recursive: true, force: true }); }
  });

  it("keeps previous counts on outage and resets observations on source-address change", async () => {
    const directory = await mkdtemp(join(tmpdir(), "episode-updates-"));
    const service = new EpisodeUpdates(join(directory, "updates.json"), (id) => episodes(id.startsWith("hianime") ? "hianime" : "aniwave", 12), async () => { throw new Error("offline"); }, () => undefined, vi.fn(), async () => undefined);
    try {
      service.seed([entry], settings);
      const failed = await service.check([entry], settings, true);
      expect(failed.counts["aniwave:show"]).toBe(12);
      expect(failed.updates).toHaveLength(0);
      expect(failed.error).toMatch(/could not be checked/);
      const changed = { ...settings, aniwaveBaseUrl: "https://other.example" };
      await service.resetSourceScope([entry], changed);
      expect(service.snapshot(changed).checkedAt).toBeUndefined();
      expect(service.snapshot(changed).updates).toHaveLength(0);
    } finally { await service.flush(); await rm(directory, { recursive: true, force: true }); }
  });
});
