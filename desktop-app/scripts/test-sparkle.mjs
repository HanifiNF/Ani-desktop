// Interactive macOS integration test. Uses a disposable copy of the packaged
// app, its real native bridge, an ephemeral key, and an isolated user profile.
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root, prepareTools } from "./sparkle-tools.mjs";

if (process.platform !== "darwin") throw new Error("This interactive test requires macOS.");
const source = join(root, "release", process.arch === "arm64" ? "mac-arm64" : "mac", "ANIdesktop.app");
if (!existsSync(join(source, "Contents/Resources/sparkle/bridge.node"))) {
  throw new Error("First run dist:mac with a SPARKLE_PUBLIC_KEY (a temporary test key is sufficient).");
}
const tools = prepareTools();
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const secret = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64");
const publicValue = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const work = mkdtempSync(join(tmpdir(), "ani-sparkle-test-"));
const marker = join(work, "relaunched");
let child;
let servedArchive = false;
let servedFeed = false;
const invalid = process.argv.includes("--invalid-signature");
const smoke = process.argv.includes("--smoke");
const server = createServer((req, res) => {
  const file = req.url === "/appcast.xml" ? "appcast.xml" : req.url === "/update.zip" ? "update.zip" : undefined;
  if (!file) { res.writeHead(404).end(); return; }
  const data = readFileSync(join(work, file));
  if (file === "update.zip") servedArchive = true;
  else servedFeed = true;
  res.writeHead(200, { "Content-Type": file.endsWith("xml") ? "application/xml" : "application/zip", "Content-Length": data.length });
  res.end(data);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const bundleId = `dev.hanifi.sparkletest.${Date.now()}`;
const sign = (file, args = []) => execFileSync(join(tools, "bin/sign_update"), ["--ed-key-file", "-", ...args, file], { input: `${secret}\n`, encoding: "utf8" }).trim();
try {
  for (const version of ["1.0.0", "1.1.0"]) {
    const app = join(work, version, "ANI Sparkle Test.app");
    execFileSync("ditto", [source, app]);
    const resources = join(app, "Contents/Resources");
    rmSync(join(resources, "app.asar"));
    mkdirSync(join(resources, "app"));
    writeFileSync(join(resources, "app/package.json"), JSON.stringify({ name: "ani-sparkle-test", version, main: "main.cjs" }));
    writeFileSync(join(resources, "app/main.cjs"), `
      const {app} = require('electron');
      const fs = require('node:fs');
      app.setPath('userData', ${JSON.stringify(join(work, "profile"))});
      app.on('window-all-closed', () => {});
      app.whenReady().then(() => {
        if (app.getVersion() === '1.1.0') {
          fs.writeFileSync(${JSON.stringify(marker)}, 'restarted');
          app.quit();
        } else {
          require(process.resourcesPath + '/sparkle/bridge.node').check();
          setTimeout(() => app.quit(), ${smoke ? 15000 : 240000}).unref();
        }
      }).catch(error => { console.error(error); app.exit(1); });
    `);
    const info = join(app, "Contents/Info.plist");
    for (const [key, value] of Object.entries({ CFBundleIdentifier: bundleId,
      CFBundleDisplayName: "ANI Sparkle Test", CFBundleVersion: version, CFBundleShortVersionString: version,
      SUPublicEDKey: publicValue, SUFeedURL: `${origin}/appcast.xml` })) {
      execFileSync("plutil", ["-replace", key, "-string", value, info]);
    }
    execFileSync("plutil", ["-remove", "ElectronAsarIntegrity", info]);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--options", "runtime", "--entitlements",
      join(root, "node_modules/app-builder-lib/templates/entitlements.mac.plist"), app], { stdio: "pipe" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
  }
  const zip = join(work, "update.zip");
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", join(work, "1.1.0/ANI Sparkle Test.app"), zip]);
  const signature = sign(zip, ["-p"]);
  // Corrupt only the archive signature; the feed itself remains correctly signed.
  const archiveSignature = invalid ? (signature[0] === "A" ? "B" : "A") + signature.slice(1) : signature;
  const feed = join(work, "appcast.xml");
  writeFileSync(feed, `<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>ANI Sparkle Test</title><item><title>Integration test update</title><sparkle:version>1.1.0</sparkle:version><sparkle:shortVersionString>1.1.0</sparkle:shortVersionString><enclosure url="${origin}/update.zip" length="${readFileSync(zip).length}" type="application/octet-stream" sparkle:edSignature="${archiveSignature}" /></item></channel></rss>`);
  sign(feed);
  const installed = join(work, "1.0.0/ANI Sparkle Test.app");
  console.log(`Fixture: ${installed}`);
  if (!smoke) console.log("Choose Install Update in the test app's Sparkle window, then Install and Relaunch.");
  if (invalid) console.log("Invalid-signature test: expect an update error, then quit the test app.");
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(join(installed, "Contents/MacOS/ANIdesktop"), [], { stdio: "inherit", env });
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && !existsSync(marker)) {
    if (child.signalCode || (child.exitCode !== null && child.exitCode !== 0)) throw new Error("Fixture app crashed before completing the update.");
    if (child.exitCode !== null || child.signalCode !== null) {
      // The old process exits before Sparkle launches the replacement.
      if (invalid || smoke) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const installedVersion = execFileSync("plutil", ["-extract", "CFBundleVersion", "raw", "-o", "-", join(installed, "Contents/Info.plist")], { encoding: "utf8" }).trim();
  if (smoke) {
    if (!servedFeed || servedArchive || installedVersion !== "1.0.0") throw new Error("Native bridge smoke test failed.");
    console.log("PASS: packaged bridge loaded, checked its signed feed, and quit cleanly.");
  } else if (invalid) {
    if (!servedArchive || existsSync(marker) || installedVersion !== "1.0.0") throw new Error("Invalid-signature rejection was not verified.");
    console.log("PASS: invalid update rejected; original app retained.");
  } else {
    if (!existsSync(marker) || installedVersion !== "1.1.0") throw new Error("Update and relaunch did not complete within four minutes.");
    console.log("PASS: packaged Electron app updated and relaunched as version 1.1.0.");
  }
  execFileSync("codesign", ["--verify", "--deep", "--strict", installed]);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
