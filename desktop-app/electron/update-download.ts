import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadItem, Event, Session } from "electron";
import type { UpdateAsset } from "./update-asset";

/** Chromium handles the native download, including the platform's downloaded-file handling. */
export async function downloadReleaseAsset(session: Session, directory: string, asset: UpdateAsset, progress: (percent: number) => void): Promise<string> {
  await mkdir(directory, { recursive: true });
  const folder = await mkdtemp(join(directory, "ANIdesktop-update-"));
  const path = join(folder, asset.name);
  try {
    await new Promise<void>((resolve, reject) => {
      let item: DownloadItem | undefined;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.removeListener("will-download", started);
        if (error) { item?.cancel(); reject(error); } else resolve();
      };
      const started = (_event: Event, download: DownloadItem) => {
        if (!download.getURLChain().includes(asset.url)) return;
        session.removeListener("will-download", started);
        item = download;
        download.setSavePath(path);
        download.on("updated", () => { if (!settled) progress(100 * download.getReceivedBytes() / asset.size); });
        download.once("done", (_event, state) => state === "completed" ? finish() : finish(new Error("Download interrupted. Try again.")));
      };
      const timer = setTimeout(() => finish(new Error("Update download timed out.")), 30 * 60_000);
      session.on("will-download", started);
      try { session.downloadURL(asset.url); } catch { finish(new Error("Could not start the update download.")); }
    });
    if ((await stat(path)).size !== asset.size) throw new Error("The downloaded update is incomplete.");
    if (asset.digest) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest("hex") !== asset.digest) throw new Error("The update checksum did not match.");
    }
    return path;
  } catch (reason) {
    await rm(folder, { recursive: true, force: true });
    throw reason;
  }
}
