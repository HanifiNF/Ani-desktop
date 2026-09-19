import { describe, expect, it, vi } from "vitest";
import { UpdateInstaller, updateInstallCapability } from "../electron/update-installer";
import { selectUpdateAsset } from "../electron/update-asset";

function setup(platform = "win32", packaged = true) {
  const backend = {
    checkForUpdates: vi.fn().mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: "1.1.0" } }),
    downloadUpdate: vi.fn().mockResolvedValue(["/cache/update.exe"]), quitAndInstall: vi.fn()
  };
  const options = { capability: updateInstallCapability(packaged, platform, "x64", "/apps/ani.AppImage"), currentVersion: "1.0.0", backend,
    manualDownload: vi.fn().mockResolvedValue("/downloads/update.dmg"), openFile: vi.fn().mockResolvedValue(""), beforeInstall: vi.fn().mockResolvedValue(undefined), publish: vi.fn() };
  return { installer: new UpdateInstaller(options), backend, options };
}

describe("update installation", () => {
  it("selects supported package modes, including source runs and extracted Linux apps", () => {
    expect(updateInstallCapability(true, "win32", "x64").mode).toBe("automatic");
    expect(updateInstallCapability(true, "linux", "x64", "/app.AppImage").mode).toBe("automatic");
    expect(updateInstallCapability(true, "linux", "x64").mode).toBe("manual");
    expect(updateInstallCapability(true, "darwin", "arm64").mode).toBe("manual");
    expect(updateInstallCapability(true, "linux", "arm64").mode).toBe("unsupported");
    expect(updateInstallCapability(false, "win32", "x64").mode).toBe("unsupported");
  });

  it("shares a download, reports progress, then installs only after an explicit request", async () => {
    const { installer, backend, options } = setup();
    let complete!: (paths: string[]) => void;
    backend.downloadUpdate.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = installer.download("1.1.0");
    expect(installer.download("1.1.0")).toBe(pending);
    await Promise.resolve();
    installer.progress(37.5);
    expect(installer.snapshot()).toMatchObject({ phase: "downloading", percent: 37.5 });
    await expect(installer.install()).rejects.toThrow("Download the update");
    complete(["/cache/update.exe"]);
    expect(await pending).toMatchObject({ phase: "ready", version: "1.1.0", percent: 100 });
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
    await installer.download("1.1.0");
    expect(backend.downloadUpdate).toHaveBeenCalledOnce();
    await installer.install();
    expect(options.beforeInstall).toHaveBeenCalledOnce();
    expect(backend.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(options.manualDownload).not.toHaveBeenCalled();
  });

  it("rejects stale metadata, failed downloads, downgrades, and source installations", async () => {
    const { installer, backend } = setup();
    await expect(installer.download("0.9.0")).rejects.toThrow();
    backend.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version: "1.2.0" } });
    expect(await installer.download("1.1.0")).toMatchObject({ phase: "error" });
    expect(backend.downloadUpdate).not.toHaveBeenCalled();
    backend.downloadUpdate.mockRejectedValueOnce(new Error("network"));
    expect(await installer.download("1.1.0")).toMatchObject({ phase: "error" });
    await expect(installer.install()).rejects.toThrow();
    expect(await installer.download("1.1.0")).toMatchObject({ phase: "ready" });
    await expect(setup("win32", false).installer.download("1.1.0")).rejects.toThrow();
  });

  it("keeps the app running and permits retry when installation preflight fails", async () => {
    const { installer, backend, options } = setup("linux");
    await installer.download("1.1.0");
    options.beforeInstall.mockRejectedValueOnce(new Error("Move the AppImage to a writable folder."));
    await installer.install();
    expect(installer.snapshot()).toMatchObject({ phase: "ready", error: "Move the AppImage to a writable folder." });
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
    await installer.install();
    expect(backend.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("opens a downloaded macOS package without quitting and retains open failures", async () => {
    const { installer, backend, options } = setup("darwin");
    await installer.download("1.1.0");
    expect(options.manualDownload).toHaveBeenCalledWith("1.1.0", expect.any(Function));
    options.openFile.mockResolvedValueOnce("File moved or deleted");
    await installer.install();
    expect(installer.snapshot()).toMatchObject({ phase: "ready", error: "File moved or deleted" });
    await installer.install();
    expect(options.openFile).toHaveBeenCalledWith("/downloads/update.dmg");
    expect(installer.snapshot()).toMatchObject({ phase: "ready", error: undefined });
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
    expect(backend.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe("release package selection", () => {
  const asset = (suffix: string) => {
    const name = `ANIdesktop-1.1.0-${suffix}`;
    return { name, browser_download_url: `https://github.com/HanifiNF/Ani-cli-aniwave/releases/download/v1.1.0/${name}`, size: 42, state: "uploaded" };
  };
  const release = { tag_name: "v1.1.0", assets: [asset("mac-arm64.dmg"), asset("mac-x64.dmg"), asset("win-x64.exe"), asset("linux-x64.AppImage")] };
  it.each([["darwin", "arm64", "mac-arm64.dmg"], ["darwin", "x64", "mac-x64.dmg"], ["win32", "x64", "win-x64.exe"], ["linux", "x64", "linux-x64.AppImage"]])("selects %s/%s", (platform, arch, suffix) => {
    expect(selectUpdateAsset(release, platform, arch)?.name).toBe(`ANIdesktop-1.1.0-${suffix}`);
  });
  it("rejects other hosts, wrong CPUs, prereleases, incomplete uploads, and unsafe names", () => {
    expect(selectUpdateAsset(release, "linux", "arm64")).toBeUndefined();
    expect(selectUpdateAsset({ ...release, prerelease: true }, "darwin", "arm64")).toBeUndefined();
    for (const change of [{ browser_download_url: "https://example.com/update.dmg" }, { state: "new" }, { size: -1 }, { name: "../update.dmg" }, { digest: "wrong" }]) {
      expect(selectUpdateAsset({ ...release, assets: [{ ...asset("mac-arm64.dmg"), ...change }] }, "darwin", "arm64")).toBeUndefined();
    }
  });
});
