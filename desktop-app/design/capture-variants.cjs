// Screenshots each [data-variant] element of a mockup page (or a selector on the live app) at the app's window width.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/capture-variants.cjs <file.html | url> <prefix> [selector]
// SHOT_CSS injects a stylesheet before capturing, for trying a rule against the live app.
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const [, , target, prefix = "variant", selector = "[data-variant]"] = process.argv;
const url = /^https?:/.test(target) ? target : pathToFileURL(resolve(target)).href;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();

app.whenReady().then(async () => {
  await mkdir(join(__dirname, "shots"), { recursive: true });
  const win = new BrowserWindow({ width: Number(process.env.SHOT_WIDTH) || 1240, height: Number(process.env.SHOT_HEIGHT) || 6000, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(url);
  if (process.env.SHOT_CSS) await win.webContents.insertCSS(process.env.SHOT_CSS);
  await wait(Number(process.env.SHOT_WAIT) || 1500);
  const rects = await win.webContents.executeJavaScript(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el, i) => { const r = el.getBoundingClientRect(); return { name: el.dataset.variant || String(i + 1), x: Math.floor(r.left), y: Math.floor(r.top + window.scrollY), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })`);
  for (const r of rects) {
    const image = await win.webContents.capturePage({ x: r.x, y: r.y, width: r.width, height: r.height });
    await writeFile(join(__dirname, "shots", `${prefix}-${r.name}.png`), image.toPNG());
    console.log(`captured ${prefix}-${r.name} (${r.width}x${r.height})`);
  }
  win.destroy(); app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
