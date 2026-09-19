import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadReleaseAsset } from "../electron/update-download";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function setup(state = "completed", digest?: string, size = 7) {
  const directory = await mkdtemp(join(tmpdir(), "ani-download-test-"));
  directories.push(directory);
  const asset = { name: "ANIdesktop-1.1.0-mac-arm64.dmg", url: "https://github.com/HanifiNF/Ani-cli-aniwave/releases/download/v1.1.0/update.dmg", version: "1.1.0", size, digest };
  const session = new EventEmitter() as EventEmitter & { downloadURL(url: string): void };
  let path = "";
  const item = Object.assign(new EventEmitter(), {
    getURLChain: () => [asset.url, "https://release-assets.githubusercontent.com/example"],
    setSavePath: (value: string) => { path = value; }, getReceivedBytes: () => 3,
    cancel: vi.fn()
  });
  session.downloadURL = (url) => {
    expect(url).toBe(asset.url);
    session.emit("will-download", {}, item);
    item.emit("updated", {}, "progressing");
    void writeFile(path, "package").then(() => item.emit("done", {}, state));
  };
  const progress = vi.fn();
  return { directory, session, item, progress, download: () => downloadReleaseAsset(session as unknown as Session, directory, asset, progress) };
}

describe("native release downloads", () => {
  it("tracks a native download, verifies its digest, and keeps the completed package", async () => {
    const { download, progress, session } = await setup("completed", createHash("sha256").update("package").digest("hex"));
    const file = await download();
    expect(await readFile(file, "utf8")).toBe("package");
    expect(progress).toHaveBeenCalledWith(100 * 3 / 7);
    expect(session.listenerCount("will-download")).toBe(0);
  });
  it.each(["cancelled", "interrupted"])("removes partial files after %s", async (state) => {
    const { download, directory, session } = await setup(state);
    await expect(download()).rejects.toThrow("Download interrupted");
    expect(await readdir(directory)).toEqual([]);
    expect(session.listenerCount("will-download")).toBe(0);
  });
  it("removes an incomplete or corrupted package", async () => {
    for (const [digest, size] of [["0".repeat(64), 7], [undefined, 8]] as const) {
      const { download, directory } = await setup("completed", digest, size);
      await expect(download()).rejects.toThrow();
      expect(await readdir(directory)).toEqual([]);
    }
  });
});
