import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { UpdateStatus } from "../shared/contracts";
import { compareStableVersions, normalizeStableVersion, UPDATE_API_URL, UPDATE_CHECK_INTERVAL } from "../shared/update";
import { selectUpdateAsset, type UpdateAsset } from "./update-asset";

const REQUEST_TIMEOUT = 10_000;

interface UpdateCache {
  version: 1;
  lastAttemptAt?: number;
  latestVersion?: string;
  dismissedVersion?: string;
  lastError?: string;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type UpdateFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<FetchResponse>;

function validateCache(value: unknown): UpdateCache {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) return { version: 1 };
  const raw = value as Partial<UpdateCache>;
  const lastAttemptAt = typeof raw.lastAttemptAt === "number" && Number.isFinite(raw.lastAttemptAt) && raw.lastAttemptAt >= 0 ? raw.lastAttemptAt : undefined;
  const latestVersion = normalizeStableVersion(raw.latestVersion);
  const dismissedVersion = normalizeStableVersion(raw.dismissedVersion);
  const lastError = typeof raw.lastError === "string" && raw.lastError.length <= 160 ? raw.lastError : undefined;
  return { version: 1, ...(lastAttemptAt === undefined ? {} : { lastAttemptAt }), ...(latestVersion ? { latestVersion } : {}),
    ...(dismissedVersion ? { dismissedVersion } : {}), ...(lastError ? { lastError } : {}) };
}

function releaseVersion(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("GitHub returned an invalid release");
  const release = value as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
  if (release.draft === true || release.prerelease === true) throw new Error("GitHub did not return a stable release");
  const version = normalizeStableVersion(release.tag_name);
  if (!version) throw new Error("GitHub returned an invalid release version");
  return version;
}

export class UpdateService {
  private cache: UpdateCache = { version: 1 };
  private loaded = false;
  private inFlight?: Promise<UpdateStatus>;
  private latestRelease?: unknown;
  /** Each opening of the app asks GitHub once, whatever the saved result's age; the daily throttle governs the polls after it. */
  private checkedSinceOpen = false;

  constructor(
    private readonly filePath: string,
    private readonly currentVersion: string,
    private readonly packaged: boolean,
    private readonly request: UpdateFetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try { this.cache = validateCache(JSON.parse(await readFile(this.filePath, "utf8"))); }
    catch { this.cache = { version: 1 }; }
  }

  /** A window opened: a launch, or on macOS a return from the dock after the last window closed. The next check goes to GitHub. */
  opened(): void { this.checkedSinceOpen = false; }

  async check(force = false): Promise<UpdateStatus> {
    await this.load();
    if (!this.packaged && !force) return this.status("development");
    const age = this.cache.lastAttemptAt === undefined ? Infinity : this.now() - this.cache.lastAttemptAt;
    if (!force && this.checkedSinceOpen && age >= 0 && age < UPDATE_CHECK_INTERVAL) return this.status();
    if (this.inFlight) return this.inFlight;
    this.checkedSinceOpen = true;
    this.inFlight = this.fetchLatest().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  async dismiss(version: string): Promise<UpdateStatus> {
    await this.load();
    const normalized = normalizeStableVersion(version);
    if (!normalized || normalized !== this.cache.latestVersion) throw new Error("Invalid update version");
    this.cache.dismissedVersion = normalized;
    await this.save();
    return this.status();
  }

  async asset(version: string, platform: string, arch: string): Promise<UpdateAsset> {
    const status = await this.check(true);
    if (status.stale || status.state !== "available" || status.latestVersion !== version) {
      throw new Error("Check for updates again before downloading.");
    }
    const asset = selectUpdateAsset(this.latestRelease, platform, arch);
    if (!asset) throw new Error("This release has no matching package. Use View release to see available downloads.");
    return asset;
  }

  private async fetchLatest(): Promise<UpdateStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    this.cache.lastAttemptAt = this.now();
    try {
      const response = await this.request(UPDATE_API_URL, { signal: controller.signal, headers: {
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ANIdesktop-update-checker"
      } });
      if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status})`);
      const release = await response.json();
      this.cache.latestVersion = releaseVersion(release);
      this.latestRelease = release;
      delete this.cache.lastError;
    } catch (reason) {
      this.cache.lastError = reason instanceof Error && reason.name === "AbortError" ? "Update check timed out"
        : reason instanceof Error && /^(GitHub|Update check)/.test(reason.message) ? reason.message : "Could not check for updates";
    } finally {
      clearTimeout(timer);
      await this.save();
    }
    return this.status();
  }

  private status(override?: "development"): UpdateStatus {
    const currentVersion = normalizeStableVersion(this.currentVersion) ?? this.currentVersion;
    if (override) return { currentVersion, state: override };
    const comparison = this.cache.latestVersion ? compareStableVersions(this.cache.latestVersion, currentVersion) : undefined;
    const available = comparison !== undefined && comparison > 0;
    const common = { currentVersion, ...(this.cache.latestVersion ? { latestVersion: this.cache.latestVersion } : {}),
      ...(this.cache.lastAttemptAt === undefined ? {} : { checkedAt: this.cache.lastAttemptAt }) };
    if (this.cache.lastError && !this.cache.latestVersion) return { ...common, state: "error", error: this.cache.lastError };
    if (available) return { ...common, state: "available", dismissed: this.cache.dismissedVersion === this.cache.latestVersion,
      ...(this.cache.lastError ? { stale: true, error: this.cache.lastError } : {}) };
    return { ...common, state: "current", ...(this.cache.lastError ? { stale: true, error: this.cache.lastError } : {}) };
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(`${this.filePath}.new`, JSON.stringify(this.cache), "utf8");
    await rename(`${this.filePath}.new`, this.filePath);
  }
}
