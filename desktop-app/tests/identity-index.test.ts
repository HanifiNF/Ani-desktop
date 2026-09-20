import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import * as zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityIndex, compactDataset, refFromSourceUrl } from "../electron/identity-index";

const zstdCompress = promisify((zlib as unknown as { zstdCompress: (buffer: Buffer, callback: (error: Error | null, result: Buffer) => void) => void }).zstdCompress);
const entry = (title: string, sources: string[], extra: Record<string, unknown> = {}) => ({ title, sources, type: "TV", episodes: 12, status: "FINISHED", animeSeason: { season: "FALL", year: 2023 }, synonyms: [], ...extra });
const dataset = { data: [
  entry("Sousou no Frieren", ["https://myanimelist.net/anime/52991", "https://anilist.co/anime/154587", "https://anidb.net/anime/17617", "https://kitsu.app/anime/46474"], { episodes: 28, synonyms: ["Frieren: Beyond Journey's End", "Frieren at the Funeral"] }),
  entry("Only on Kitsu", ["https://kitsu.app/anime/1"]),
  entry("JoJo no Kimyou na Bouken Part 3: Stardust Crusaders 2nd Season", ["https://myanimelist.net/anime/26055"], { episodes: 24, animeSeason: { season: "WINTER", year: 2015 }, synonyms: ["JoJo's Bizarre Adventure: Stardust Crusaders - Battle in Egypt"] }),
  { title: "", sources: ["https://myanimelist.net/anime/2"] }
] };

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "title-index-")); });
afterEach(() => rm(directory, { recursive: true, force: true }));

describe("offline title index", () => {
  it("compacts dataset entries to titles, facts, and references", () => {
    expect(refFromSourceUrl("https://myanimelist.net/anime/52991")).toBe("mal:52991");
    expect(refFromSourceUrl("https://example.com/anime/1")).toBeUndefined();
    const entries = compactDataset(dataset);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ t: "Sousou no Frieren", s: ["Frieren: Beyond Journey's End", "Frieren at the Funeral"], refs: ["mal:52991", "anilist:154587", "anidb:17617", "kitsu:46474"], y: "TV", e: 28, r: 2023 });
  });

  it("downloads, decompresses, stores, and answers title lookups; a reload reads the stored copy", async () => {
    const big = { data: [...dataset.data, ...Array.from({ length: 1000 }, (_, index) => entry(`Filler ${index}`, [`https://myanimelist.net/anime/${1000 + index}`]))] };
    const download = vi.fn(async () => new Response(new Uint8Array(await zstdCompress(Buffer.from(JSON.stringify(big)))), { status: 200 }));
    const index = new IdentityIndex(join(directory, "title-index.json"), download);
    await index.load();
    expect(index.status(true)).toMatchObject({ enabled: true, entries: 0, updating: false });
    expect(index.needsUpdate()).toBe(true);
    const status = await index.update();
    expect(status).toMatchObject({ entries: 1002, updating: false });
    expect(status.error).toBeUndefined();
    expect(index.needsUpdate()).toBe(false);
    expect(index.candidatesFor(["Frieren: Beyond Journey's End"])).toEqual([expect.objectContaining({ refs: ["mal:52991", "anilist:154587", "anidb:17617", "kitsu:46474"], type: "TV", year: 2023, episodes: 28 })]);
    expect(index.candidatesFor(["Nothing like this"])).toEqual([]);
    expect(index.candidatesForSearch("battle in egypt", [])).toEqual([expect.objectContaining({ refs: ["mal:26055"] })]);
    expect(JSON.parse(await readFile(join(directory, "title-index.json"), "utf8")).entries).toHaveLength(1002);
    const reloaded = new IdentityIndex(join(directory, "title-index.json"), download);
    await reloaded.load();
    expect(reloaded.size).toBe(1002);
    expect(reloaded.candidatesFor(["sousou no frieren"])).toHaveLength(1);
    expect(reloaded.candidatesForRefs(["anilist:154587"])).toEqual(reloaded.candidatesFor(["sousou no frieren"]));
    expect(reloaded.candidatesForRefs(["mal:52991", "anilist:154587"])).toHaveLength(1);
    expect(reloaded.candidatesForRefs(["mal:52991", "anilist:99"])).toEqual([]);
    expect(reloaded.candidatesForRefs(["anilist:99999999"])).toEqual([]);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("keeps the old index and reports the failure when a download is bad", async () => {
    const index = new IdentityIndex(join(directory, "title-index.json"), vi.fn(async () => new Response("nope", { status: 503 })));
    expect(await index.update()).toMatchObject({ entries: 0, error: "Index download failed (503)" });
    const tiny = new IdentityIndex(join(directory, "title-index.json"), vi.fn(async () => new Response(new Uint8Array(await zstdCompress(Buffer.from(JSON.stringify(dataset)))), { status: 200 })));
    expect((await tiny.update()).error).toMatch(/too few entries/);
  });
});
