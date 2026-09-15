export const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1_000;
export const UPDATE_API_URL = "https://api.github.com/repos/HanifiNF/Ani-cli-aniwave/releases/latest";
export const LATEST_RELEASE_URL = "https://github.com/HanifiNF/Ani-cli-aniwave/releases/latest";

export interface StableVersion { major: number; minor: number; patch: number; }

export function parseStableVersion(value: unknown): StableVersion | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
  if (!match) return undefined;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return undefined;
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

export function normalizeStableVersion(value: unknown): string | undefined {
  const version = parseStableVersion(value);
  return version ? `${version.major}.${version.minor}.${version.patch}` : undefined;
}

export function compareStableVersions(left: string, right: string): number | undefined {
  const a = parseStableVersion(left), b = parseStableVersion(right);
  if (!a || !b) return undefined;
  return Math.sign(a.major - b.major || a.minor - b.minor || a.patch - b.patch);
}
