// Captures the home, saved, and recent screens with an empty library (removes every seeded card first).
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/capture-empty.cjs [url]
// SHOT_KEEP=1 leaves the seeded library in place, for the same pages with content.
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const url = process.argv[2] || "http://127.0.0.1:5173/";
const size = { width: Number(process.env.SHOT_WIDTH) || 1240, height: Number(process.env.SHOT_HEIGHT) || 800 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();

app.whenReady().then(async () => {
  await mkdir(join(__dirname, "shots"), { recursive: true });
  const win = new BrowserWindow({ ...size, show: false, frame: false, webPreferences: { offscreen: true } });
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name, ms = 600) => {
    await wait(ms);
    await writeFile(join(__dirname, "shots", `empty-${name}${process.env.SHOT_SUFFIX || ""}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`captured empty-${name}`);
  };
  const click = (selector) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing " + ${JSON.stringify(selector)}); el.click(); return true; })()`);
  await win.loadURL(url);
  await wait(1200);
  for (let i = 0; i < (process.env.SHOT_KEEP ? 0 : 12); i++) {
    const removed = await js(`(() => { const b = document.querySelector('.card-acts .mini-act[title="Remove"]'); if (!b) return false; b.click(); return true; })()`);
    if (!removed) break;
    await wait(250);
  }
  await shot("home", 2500);
  await click('button[title="saved"]');
  await shot("saved", 2500);
  await click('button[title="recent"]');
  await shot("recent", 2500);
  await click('button[title="settings"]');
  await js("document.querySelector('.page').scrollTo(0, 700); true");
  await shot("settings");
  win.destroy(); app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
