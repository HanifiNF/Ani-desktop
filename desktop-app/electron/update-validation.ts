import { normalizeStableVersion } from "../shared/update";

export function validateUpdateCheck(force: unknown): boolean {
  if (force !== undefined && typeof force !== "boolean") throw new Error("Invalid update check request");
  return force === true;
}

export function validateUpdateVersion(value: unknown): string {
  if (typeof value !== "string" || value.length > 32) throw new Error("Invalid update version");
  const version = normalizeStableVersion(value);
  if (!version) throw new Error("Invalid update version");
  return version;
}
