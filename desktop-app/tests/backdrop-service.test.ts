import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackdropService, type Download } from "../electron/backdrop-service";
import { BACKDROP_API, type BackdropEntry } from "../shared/backdrops";

const pool: BackdropEntry[] = [{ id: 1, kind: "wide" }, { id: 2, kind: "wide" }, { id: 3, kind: "portrait" }];
const bytes = new Uint8Array([82, 73, 70, 70]);
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const image = () => new Response(bytes, { status: 200, headers: { "content-type": "image/webp", "content-length": String(bytes.byteLength) } });
const okDownload: Download = async (url) => {
  const id = url.startsWith(BACKDROP_API) ? Number(url.slice(BACKDROP_API.length + 1)) : undefined;
  if (id !== undefined) return json({ id, url: `https://cdn.test/${id}.webp`, source_url: id === 1 ? "https://danbooru.donmai.us/post/show/1" : null, artist_name: id === 2 ? "xilmo" : null, color_dominant: id === 1 ? [216, 203, 187] : [40, 30, 50] });
  return image();
};

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "ani-backdrops-")); });
afterEach(() => rm(directory, { recursive: true, force: true }));

describe("BackdropService", () => {
  it("downloads one image of the kind asked for and serves it as a data URL with its credit", async () => {
    const download = vi.fn(okDownload);
    const service = new BackdropService(download, pool, () => 0);
    await service.load(directory);
    const art = await service.pick("wide");
    expect(art).toMatchObject({ id: 1, kind: "wide", sourceUrl: "https://danbooru.donmai.us/post/show/1", light: true });
    expect(art?.src).toBe(`data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`);
    expect(download.mock.calls.map(([url]) => url)).toEqual([`${BACKDROP_API}/1`, "https://cdn.test/1.webp"]);
    expect(await readdir(directory)).toEqual(expect.arrayContaining(["1.img", "index.json"]));
  });

  it("fetches at most one new image per run and reuses what is on disk afterwards", async () => {
    const download = vi.fn(okDownload);
    const service = new BackdropService(download, pool, () => 0);
    await service.load(directory);
    await service.pick("wide");
    await service.pick("wide");
    await service.pick("wide");
    expect(download).toHaveBeenCalledTimes(2);
    expect(service.cached("wide")).toEqual([1]);
  });

  it("serves cached images without the network after a restart, and nothing when there is no cache", async () => {
    const service = new BackdropService(okDownload, pool, () => 0);
    await service.load(directory);
    await service.pick("portrait");
    const offline = new BackdropService(async () => { throw new Error("offline"); }, pool, () => 0);
    await offline.load(directory);
    expect(await offline.pick("portrait")).toMatchObject({ id: 3, light: undefined });
    expect(await offline.pick("wide")).toBeUndefined();
  });

  it("rejects files that are not images or too large", async () => {
    const bad: Download = async (url) => url.startsWith(BACKDROP_API) ? okDownload(url) : new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    const service = new BackdropService(bad, pool, () => 0);
    await service.load(directory);
    expect(await service.pick("wide")).toBeUndefined();
    expect((await readdir(directory)).filter((name) => name.endsWith(".img"))).toEqual([]);
  });
});
