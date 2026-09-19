import type { UpdateInstallStatus } from "../shared/contracts";
import { compareStableVersions, normalizeStableVersion } from "../shared/update";

export interface UpdateBackend {
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(silent?: boolean, restart?: boolean): void;
}

export function updateInstallCapability(packaged: boolean, platform: string, arch: string, appImage?: string, sparkle = false): UpdateInstallStatus {
  const base = { phase: "idle" as const };
  if (!packaged) return { ...base, mode: "unsupported", detail: "Install updates from a packaged release of ANIdesktop." };
  if (platform === "darwin" && sparkle) return { ...base, mode: "native",
    detail: "A macOS update window will guide you through downloading, installing, and restarting ANIdesktop." };
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) return { ...base, mode: "manual",
    detail: "Download the DMG, open it, then quit ANIdesktop and replace it in Applications." };
  if (platform === "win32" && arch === "x64") return { ...base, mode: "automatic",
    detail: "Download the update, then install and restart. Windows may ask for administrator permission." };
  if (platform === "linux" && arch === "x64") return { ...base, mode: appImage ? "automatic" : "manual",
    detail: appImage ? "Download the update, then install and restart. Keep your AppImage in a writable folder."
      : "Download the AppImage and replace your current copy. Run it as an AppImage to enable install and restart." };
  return { ...base, mode: "unsupported", detail: "Use View release to find a package for your operating system and processor." };
}

interface InstallerOptions {
  capability: UpdateInstallStatus;
  currentVersion: string;
  backend?: UpdateBackend;
  nativeCheck?(): void;
  manualDownload(version: string, progress: (percent: number) => void): Promise<string>;
  openFile(path: string): Promise<string>;
  beforeInstall(): Promise<void>;
  publish(status: UpdateInstallStatus): void;
}

/** Owns one download across window navigation/closure. Paths and updater controls stay in the main process. */
export class UpdateInstaller {
  private status: UpdateInstallStatus;
  private pending?: Promise<UpdateInstallStatus>;
  private file?: string;

  constructor(private readonly options: InstallerOptions) { this.status = { ...options.capability }; }
  snapshot(): UpdateInstallStatus { return { ...this.status }; }
  private set(value: Partial<UpdateInstallStatus>): void {
    this.status = { ...this.status, ...value };
    this.options.publish(this.snapshot());
  }
  progress(percent: number): void {
    if (this.status.phase === "downloading" && Number.isFinite(percent)) this.set({ percent: Math.max(0, Math.min(100, percent)) });
  }
  failed(): void {
    this.set({ phase: "error", error: "Update failed. Try again or use View release to install manually." });
  }
  download(version: string): Promise<UpdateInstallStatus> {
    if (this.pending) return this.pending;
    if (this.status.phase === "installing") return Promise.resolve(this.snapshot());
    if (this.status.mode === "unsupported" || normalizeStableVersion(version) !== version
      || compareStableVersions(version, this.options.currentVersion) !== 1) return Promise.reject(new Error("Invalid update request"));
    if (this.status.phase === "ready" && this.status.version === version) return Promise.resolve(this.snapshot());
    this.file = undefined;
    this.set({ phase: "downloading", version, percent: 0, error: undefined });
    this.pending = this.runDownload(version).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async runDownload(version: string): Promise<UpdateInstallStatus> {
    try {
      if (this.status.mode === "native") {
        if (!this.options.nativeCheck) throw new Error("Native updates are unavailable.");
        this.options.nativeCheck();
        this.set({ phase: "idle", percent: undefined, error: undefined });
        return this.snapshot();
      } else if (this.status.mode === "automatic") {
        const backend = this.options.backend;
        if (!backend) throw new Error("Automatic updates are unavailable.");
        const result = await backend.checkForUpdates();
        if (!result?.isUpdateAvailable || normalizeStableVersion(result.updateInfo.version) !== version) {
          throw new Error("The release changed. Check for updates again.");
        }
        const files = await backend.downloadUpdate();
        if (!files.length) throw new Error("The update download did not complete.");
      } else {
        this.file = await this.options.manualDownload(version, (percent) => this.progress(percent));
      }
      this.set({ phase: "ready", percent: 100, error: undefined });
    } catch {
      this.failed();
    }
    return this.snapshot();
  }
  async install(): Promise<void> {
    if (this.status.phase !== "ready") throw new Error("Download the update before installing.");
    this.set({ phase: "installing", error: undefined });
    try {
      if (this.status.mode === "manual" && this.file) {
        const error = await this.options.openFile(this.file);
        if (error) throw new Error(error);
        this.set({ phase: "ready" });
      } else if (this.status.mode === "automatic" && this.options.backend) {
        await this.options.beforeInstall();
        this.options.backend.quitAndInstall(false, true);
      } else throw new Error("Update installation is unavailable.");
    } catch (reason) {
      this.set({ phase: "ready", error: reason instanceof Error ? reason.message : "Could not open the update." });
    }
  }
}
