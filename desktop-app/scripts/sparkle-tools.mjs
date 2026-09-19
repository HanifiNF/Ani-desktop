import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const sparkleVersion = "2.10.0";
export const toolsDir = join(root, "build", `sparkle-${sparkleVersion}`);
const digest = "c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c";

export function prepareTools() {
  if (process.platform !== "darwin") throw new Error("Sparkle packaging requires macOS.");
  mkdirSync(join(root, "build"), { recursive: true });
  const archive = join(root, "build", `Sparkle-${sparkleVersion}.tar.xz`);
  if (!existsSync(archive)) execFileSync("curl", ["--fail", "--location", "--retry", "3", "--output", archive,
    `https://github.com/sparkle-project/Sparkle/releases/download/${sparkleVersion}/Sparkle-${sparkleVersion}.tar.xz`], { stdio: "inherit" });
  if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== digest) {
    rmSync(archive);
    throw new Error("Sparkle download checksum mismatch. Run again to fetch a fresh copy.");
  }
  // Always extract from the verified archive, including on cached CI runners.
  rmSync(toolsDir, { recursive: true, force: true });
  mkdirSync(toolsDir);
  execFileSync("tar", ["-xJf", archive, "-C", toolsDir]);
  return toolsDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`Sparkle tools: ${prepareTools()}/bin`);
}
