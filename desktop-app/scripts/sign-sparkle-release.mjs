import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareTools } from "./sparkle-tools.mjs";

// Only the trusted publication job receives this secret. Pass it to Sparkle via
// stdin so it never appears in command arguments, files, or build artifacts.
const secret = process.env.SPARKLE_PRIVATE_KEY?.trim();
delete process.env.SPARKLE_PRIVATE_KEY;
const publicKey = process.env.SPARKLE_PUBLIC_KEY?.trim();
const version = process.env.RELEASE_VERSION;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("RELEASE_VERSION must be a stable version.");
if (!secret || !/^[A-Za-z0-9+/]{43}=$/.test(secret)) throw new Error("SPARKLE_PRIVATE_KEY must be a new-format Sparkle key (32-byte base64 seed).");
const key = createPrivateKey({ format: "der", type: "pkcs8",
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(secret, "base64")]) });
const derivedPublic = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
if (derivedPublic !== publicKey) throw new Error("SPARKLE_PRIVATE_KEY does not match SPARKLE_PUBLIC_KEY.");
const tools = prepareTools();
const artifacts = resolve(process.argv[2] ?? "release");
const temp = mkdtempSync(join(tmpdir(), "ani-sparkle-sign-"));
try {
  for (const arch of ["x64", "arm64"]) {
    const name = `ANIdesktop-${version}-mac-${arch}.zip`;
    const archive = join(artifacts, name);
    const plist = execFileSync("unzip", ["-p", archive, "ANIdesktop.app/Contents/Info.plist"]);
    const readPlist = (field) => execFileSync("plutil", ["-extract", field, "raw", "-o", "-", "-"], { input: plist, encoding: "utf8" }).trim();
    if (readPlist("SUPublicEDKey") !== publicKey || readPlist("CFBundleVersion") !== version
      || readPlist("SURequireSignedFeed") !== "true"
      || readPlist("SUFeedURL") !== `https://github.com/HanifiNF/Ani-desktop/releases/latest/download/appcast-${arch}.xml`) {
      throw new Error(`Unexpected Sparkle configuration in ${name}.`);
    }
    const folder = join(temp, arch);
    mkdirSync(folder);
    copyFileSync(archive, join(folder, name));
    const feed = join(artifacts, `appcast-${arch}.xml`);
    execFileSync(join(tools, "bin/generate_appcast"), ["--ed-key-file", "-", "--maximum-deltas", "0",
      "--download-url-prefix", `https://github.com/HanifiNF/Ani-desktop/releases/download/v${version}/`,
      "-o", feed, folder], { input: `${secret}\n`, stdio: ["pipe", "inherit", "inherit"] });
    execFileSync(join(tools, "bin/sign_update"), ["--ed-key-file", "-", "--verify", feed],
      { input: `${secret}\n`, stdio: ["pipe", "inherit", "inherit"] });
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
