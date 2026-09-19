import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { root, prepareTools } from "./sparkle-tools.mjs";

const require = createRequire(import.meta.url);
const { build, Platform, Arch } = require("electron-builder");
const { version } = require("../package.json");
const publicKey = process.env.SPARKLE_PUBLIC_KEY?.trim();
if (publicKey && !/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) throw new Error("SPARKLE_PUBLIC_KEY must be a base64-encoded 32-byte public key.");
const tools = publicKey ? prepareTools() : undefined;
console.log(publicKey ? "Packaging with Sparkle install and restart." : "SPARKLE_PUBLIC_KEY absent: packaging with manual DMG updates.");

await build({
  targets: Platform.MAC.createTarget(["dmg", "zip"], Arch.x64, Arch.arm64),
  publish: "never",
  config: {
    buildVersion: version,
    afterPack: async ({ appOutDir, arch }) => {
      if (!tools) return;
      const cpu = arch === Arch.arm64 ? "arm64" : "x64";
      const contents = join(appOutDir, "ANIdesktop.app", "Contents");
      const resources = join(contents, "Resources", "sparkle");
      mkdirSync(resources, { recursive: true });
      execFileSync("ditto", [join(tools, "Sparkle.framework"), join(contents, "Frameworks", "Sparkle.framework")]);
      copyFileSync(join(tools, "LICENSE"), join(resources, "Sparkle-LICENSE"));
      copyFileSync(join(root, "node_modules/node-api-headers/LICENSE"), join(resources, "node-api-headers-LICENSE"));
      execFileSync("xcrun", ["clang", "-arch", cpu === "x64" ? "x86_64" : cpu, "-mmacosx-version-min=12.0",
        "-fobjc-arc", "-DNAPI_VERSION=8", "-bundle", "-undefined", "dynamic_lookup",
        "-I", join(root, "node_modules/node-api-headers/include"), "-F", tools,
        "-framework", "AppKit", "-framework", "Sparkle", "-Wl,-rpath,@loader_path/../../Frameworks",
        join(root, "native/sparkle/bridge.m"), "-o", join(resources, "bridge.node")], { stdio: "inherit" });
      const info = join(contents, "Info.plist");
      const fields = {
        SUPublicEDKey: publicKey,
        SUFeedURL: `https://github.com/HanifiNF/Ani-desktop/releases/latest/download/appcast-${cpu}.xml`,
        SUEnableAutomaticChecks: false,
        SUAutomaticallyUpdate: false,
        SUAllowsAutomaticUpdates: false,
        SUVerifyUpdateBeforeExtraction: true,
        SURequireSignedFeed: true
      };
      for (const [key, value] of Object.entries(fields)) execFileSync("plutil", ["-insert", key,
        typeof value === "boolean" ? "-bool" : "-string", String(value), info]);
    }
  }
});
