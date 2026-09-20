import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKDROP_API, BACKDROP_POOL, type BackdropEntry } from "../shared/backdrops";
import type { BackdropArt, BackdropKind } from "../shared/contracts";

// The image CDN answers 403 to anything that does not look like a browser.
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_BYTES = 4_000_000;
/** How many new images one run of the app may fetch; the rest of the pool arrives over later launches. */
const DOWNLOADS_PER_SESSION = 1;
/** With images already on disk, how often a page asks for one it has not cached yet. */
const GROW_CHANCE = 0.35;

interface Meta { id: number; url: string; mime: string; sourceUrl?: string; artist?: string; light?: boolean; }

/** Whether a dominant colour reads as pale: relative luminance above the midpoint. */
export const isLight = (rgb: unknown): boolean | undefined => Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => typeof v === "number")
  ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 > 0.5 : undefined;
export type Download = (url: string) => Promise<Response>;

const defaultDownload: Download = (url) => fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": USER_AGENT, Accept: "application/json, image/*" } });
const imageFile = (id: number) => `${id}.img`;

/**
 * Illustrations behind the home, browse, saved, and recent pages, kept on disk under the app's data folder. A page gets a random cached image of the
 * kind it asked for; at most one new image is downloaded per run so the pool fills in quietly over time.
 */
export class BackdropService {
  private dir?: string;
  private readonly metas = new Map<number, Meta>();
  private downloads = 0;
  private inflight?: Promise<Meta | undefined>;

  constructor(private readonly download: Download = defaultDownload, private readonly pool: readonly BackdropEntry[] = BACKDROP_POOL, private readonly random: () => number = Math.random) {}

  async load(dir: string): Promise<void> {
    this.dir = dir;
    this.metas.clear();
    this.downloads = 0;
    await mkdir(dir, { recursive: true });
    let files: string[] = [];
    try { files = await readdir(dir); } catch { /* an unreadable folder simply holds nothing */ }
    try {
      const data = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as { images?: unknown[] };
      for (const row of Array.isArray(data.images) ? data.images : []) {
        const meta = row as Meta;
        if (typeof meta?.id !== "number" || typeof meta.url !== "string" || typeof meta.mime !== "string" || !files.includes(imageFile(meta.id))) continue;
        this.metas.set(meta.id, { id: meta.id, url: meta.url, mime: meta.mime, sourceUrl: typeof meta.sourceUrl === "string" ? meta.sourceUrl : undefined, artist: typeof meta.artist === "string" ? meta.artist : undefined, light: meta.light === true ? true : undefined });
      }
    } catch { /* the index is rebuilt as images are fetched again */ }
  }

  /** Every pool image of the kind that is on disk. */
  cached(kind: BackdropKind): number[] {
    return this.pool.filter((entry) => entry.kind === kind && this.metas.has(entry.id)).map((entry) => entry.id);
  }

  async pick(kind: BackdropKind): Promise<BackdropArt | undefined> {
    if (!this.dir) return undefined;
    const candidates = this.pool.filter((entry) => entry.kind === kind);
    const ready = candidates.filter((entry) => this.metas.has(entry.id));
    const missing = candidates.filter((entry) => !this.metas.has(entry.id));
    const choose = (list: BackdropEntry[]) => list[Math.floor(this.random() * list.length)];
    let entry: BackdropEntry | undefined = ready.length ? choose(ready) : undefined;
    const wantsNew = missing.length > 0 && this.downloads < DOWNLOADS_PER_SESSION && (!entry || this.random() < GROW_CHANCE);
    if (wantsNew) {
      const fetched = await this.fetchOne(choose(missing));
      if (fetched) entry = fetched;
    }
    if (!entry) return undefined;
    const meta = this.metas.get(entry.id);
    if (!meta) return undefined;
    try {
      const bytes = await readFile(join(this.dir, imageFile(entry.id)));
      return { id: entry.id, kind, src: `data:${meta.mime};base64,${bytes.toString("base64")}`, sourceUrl: meta.sourceUrl, artist: meta.artist, light: meta.light };
    } catch {
      this.metas.delete(entry.id);
      return undefined;
    }
  }

  private fetchOne(entry: BackdropEntry): Promise<BackdropEntry | undefined> {
    // Two pages asking at once share one download.
    if (!this.inflight) {
      this.downloads += 1;
      this.inflight = this.fetchInto(entry).catch(() => undefined).finally(() => { this.inflight = undefined; });
    }
    return this.inflight.then((meta) => meta ? this.pool.find((item) => item.id === meta.id) : undefined);
  }

  private async fetchInto(entry: BackdropEntry): Promise<Meta | undefined> {
    const dir = this.dir;
    if (!dir) return undefined;
    const info = await this.download(`${BACKDROP_API}/${entry.id}`);
    if (!info.ok) return undefined;
    const record = await info.json() as { url?: unknown; source_url?: unknown; artist_name?: unknown; color_dominant?: unknown };
    if (typeof record.url !== "string" || !record.url.startsWith("https://")) return undefined;
    const image = await this.download(record.url);
    const mime = image.headers.get("content-type")?.split(";")[0].trim() ?? "";
    const length = Number(image.headers.get("content-length"));
    if (!image.ok || !mime.startsWith("image/") || length > MAX_BYTES) return undefined;
    const bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return undefined;
    const path = join(dir, imageFile(entry.id));
    await writeFile(`${path}.new`, bytes);
    await rename(`${path}.new`, path);
    const meta: Meta = { id: entry.id, url: record.url, mime, sourceUrl: typeof record.source_url === "string" ? record.source_url : undefined, artist: typeof record.artist_name === "string" ? record.artist_name : undefined, light: isLight(record.color_dominant) };
    this.metas.set(entry.id, meta);
    await this.writeIndex();
    return meta;
  }

  private async writeIndex(): Promise<void> {
    if (!this.dir) return;
    const path = join(this.dir, "index.json");
    await writeFile(`${path}.new`, JSON.stringify({ version: 1, images: [...this.metas.values()] }), "utf8");
    await rename(`${path}.new`, path);
  }
}
