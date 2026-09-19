import { normalizeStableVersion } from "../shared/update";

export interface UpdateAsset { version: string; name: string; url: string; size: number; digest?: string }

/** Match the package names produced by electron-builder, never source archives or another CPU's installer. */
export function selectUpdateAsset(release: unknown, platform: string, arch: string): UpdateAsset | undefined {
  if (!release || typeof release !== "object") return undefined;
  const raw = release as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  const version = normalizeStableVersion(raw.tag_name);
  if (!version || raw.draft === true || raw.prerelease === true || !Array.isArray(raw.assets)) return undefined;
  const target = platform === "darwin" && (arch === "arm64" || arch === "x64") ? `mac-${arch}.dmg`
    : platform === "win32" && arch === "x64" ? "win-x64.exe"
    : platform === "linux" && arch === "x64" ? "linux-x64.AppImage" : undefined;
  if (!target) return undefined;
  const name = `ANIdesktop-${version}-${target}`;
  const urls = ["Ani-desktop", "Ani-cli-aniwave"].map((repo) => `https://github.com/HanifiNF/${repo}/releases/download/${raw.tag_name}/${name}`);
  for (const item of raw.assets) {
    if (!item || typeof item !== "object") continue;
    const asset = item as { name?: unknown; browser_download_url?: unknown; size?: unknown; digest?: unknown; state?: unknown };
    const url = asset.browser_download_url;
    if (asset.name !== name || typeof url !== "string" || !urls.includes(url) || asset.state !== "uploaded"
      || typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
    if (asset.digest != null && (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest))) continue;
    return { version, name, url, size: asset.size, ...(typeof asset.digest === "string" ? { digest: asset.digest.slice(7) } : {}) };
  }
  return undefined;
}
