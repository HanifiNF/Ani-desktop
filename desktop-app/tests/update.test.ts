import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateService, type UpdateFetch } from "../electron/update-service";
import { validateUpdateCheck, validateUpdateVersion } from "../electron/update-validation";
import { compareStableVersions, LATEST_RELEASE_URL, normalizeStableVersion, parseStableVersion, UPDATE_API_URL, UPDATE_CHECK_INTERVAL } from "../shared/update";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function path(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ani-update-"));
  directories.push(directory);
  return join(directory, "update-check.json");
}

const response = (tag: string, options: { ok?: boolean; status?: number; draft?: boolean; prerelease?: boolean } = {}) => ({
  ok: options.ok ?? true, status: options.status ?? 200,
  async json() { return { tag_name: tag, draft: options.draft ?? false, prerelease: options.prerelease ?? false }; }
});

describe("stable release versions", () => {
  it("parses and compares stable semantic versions numerically", () => {
    expect(parseStableVersion("v1.2.10")).toEqual({ major: 1, minor: 2, patch: 10 });
    expect(normalizeStableVersion("v01.2.3")).toBeUndefined();
    expect(normalizeStableVersion("1.2.3-beta.1")).toBeUndefined();
    expect(compareStableVersions("1.10.0", "1.9.12")).toBe(1);
    expect(compareStableVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareStableVersions("1.9.9", "2.0.0")).toBe(-1);
    expect(compareStableVersions("latest", "2.0.0")).toBeUndefined();
  });

  it("validates IPC values and keeps the release destination fixed", () => {
    expect(validateUpdateCheck(undefined)).toBe(false);
    expect(validateUpdateCheck(true)).toBe(true);
    expect(() => validateUpdateCheck("yes")).toThrow("Invalid update check request");
    expect(validateUpdateVersion("v1.2.3")).toBe("1.2.3");
    expect(() => validateUpdateVersion("../latest")).toThrow("Invalid update version");
    expect(LATEST_RELEASE_URL).toBe("https://github.com/HanifiNF/Ani-cli-aniwave/releases/latest");
  });
});

describe("update service", () => {
  it("finds, caches, throttles, dismisses, and reveals a later version", async () => {
    let now = 1_000;
    const request = vi.fn<UpdateFetch>().mockResolvedValue(response("v1.2.10"));
    const file = await path(), service = new UpdateService(file, "1.2.3", true, request, () => now);
    const available = await service.check();
    expect(request).toHaveBeenCalledWith(UPDATE_API_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(available).toMatchObject({ state: "available", currentVersion: "1.2.3", latestVersion: "1.2.10", dismissed: false, checkedAt: now });
    expect((await service.check()).state).toBe("available");
    expect(request).toHaveBeenCalledOnce();

    expect(await service.dismiss("v1.2.10")).toMatchObject({ state: "available", dismissed: true });
    now += UPDATE_CHECK_INTERVAL;
    request.mockResolvedValueOnce(response("v1.3.0"));
    expect(await service.check()).toMatchObject({ state: "available", latestVersion: "1.3.0", dismissed: false });
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ version: 1, latestVersion: "1.3.0", dismissedVersion: "1.2.10" });
  });

  it("asks again every time the app opens, inside the daily interval too", async () => {
    let now = 1_000;
    const request = vi.fn<UpdateFetch>().mockResolvedValue(response("v1.2.3"));
    const file = await path();
    expect((await new UpdateService(file, "1.2.3", true, request, () => now).check()).state).toBe("current");
    now += 60_000;
    request.mockResolvedValueOnce(response("v1.2.4"));
    const relaunched = new UpdateService(file, "1.2.3", true, request, () => now);
    expect(await relaunched.check()).toMatchObject({ state: "available", latestVersion: "1.2.4", checkedAt: now });
    expect(request).toHaveBeenCalledTimes(2);
    await relaunched.check();
    expect(request).toHaveBeenCalledTimes(2);

    // macOS keeps the app running without a window; a new window is an opening too.
    relaunched.opened();
    await relaunched.check();
    expect(request).toHaveBeenCalledTimes(3);
    await relaunched.check();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("treats equal and older releases as current", async () => {
    const equal = new UpdateService(await path(), "2.0.0", true, vi.fn<UpdateFetch>().mockResolvedValue(response("v2.0.0")));
    expect((await equal.check()).state).toBe("current");
    const older = new UpdateService(await path(), "2.0.0", true, vi.fn<UpdateFetch>().mockResolvedValue(response("v1.9.9")));
    expect((await older.check()).state).toBe("current");
  });

  it("preserves a valid cached release when a forced refresh fails", async () => {
    const request = vi.fn<UpdateFetch>().mockResolvedValueOnce(response("v3.0.0")).mockRejectedValueOnce(new Error("offline details"));
    const service = new UpdateService(await path(), "2.0.0", true, request);
    await service.check();
    expect(await service.check(true)).toMatchObject({ state: "available", latestVersion: "3.0.0", stale: true, error: "Could not check for updates" });
  });

  it("skips automatic development checks and recovers from damaged persistence", async () => {
    const request = vi.fn<UpdateFetch>().mockResolvedValue(response("v2.0.0"));
    const development = new UpdateService(await path(), "1.0.0", false, request);
    expect(await development.check()).toEqual({ currentVersion: "1.0.0", state: "development" });
    expect(request).not.toHaveBeenCalled();

    const file = await path();
    await writeFile(file, "not json", "utf8");
    const recovered = new UpdateService(file, "1.0.0", true, request);
    expect(await recovered.check()).toMatchObject({ state: "available", latestVersion: "2.0.0" });
  });

  it("times out a stalled request with a safe error", async () => {
    const request = vi.fn<UpdateFetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); });
    }));
    const service = new UpdateService(await path(), "1.0.0", true, request);
    await service.load();
    vi.useFakeTimers();
    const pending = service.check();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ state: "error", error: "Update check timed out" });
  });
});
