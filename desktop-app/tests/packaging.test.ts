import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("cross-platform desktop packaging", () => {
  it("pins the embedded player and configures Windows and ad-hoc signed macOS artifacts", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as Record<string, any>;
    expect(pkg.packageManager).toMatch(/^npm@/);
    expect(pkg.dependencies).toMatchObject({ "@vidstack/react": "1.15.6", "hls.js": "1.7.2" });
    expect(pkg.build.win).toMatchObject({ target: "nsis", icon: "build/icons/icon.ico" });
    expect(pkg.build.mac).toMatchObject({ target: "dmg", icon: "build/icons/icon.icns", identity: "-" });
    expect(pkg.scripts["dist:mac"]).toContain("scripts/package-macos.mjs");
  });

  it("generates a macOS icon", async () => {
    const icons = await readFile(new URL("../scripts/generate-icons.mjs", import.meta.url), "utf8");
    expect(icons).toContain('new URL("icon.icns", output)');
  });
});
