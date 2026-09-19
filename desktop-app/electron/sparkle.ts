import { existsSync } from "node:fs";
import { join } from "node:path";

/** Only packaged macOS builds contain this optional native addon. */
export function loadSparkle(packaged: boolean, platform: string, resources: string): { check(): void } | undefined {
  if (!packaged || platform !== "darwin") return undefined;
  const path = join(resources, "sparkle", "bridge.node");
  if (!existsSync(path)) return undefined;
  return require(path) as { check(): void };
}
