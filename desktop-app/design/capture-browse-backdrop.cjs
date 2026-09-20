// Captures the Browse page with each backdrop variant (npx vite, in-memory dev API).
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/capture-browse-backdrop.cjs [url]
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
  // The variant and the image both come from Math.random: below .5 is the wash, above it the corner figure.
  for (const [name, rolls] of [["wash", [0.1, 0.3, 0.7]], ["corner", [0.6, 0.35, 0.8]]]) {
    for (const [index, roll] of rolls.entries()) {
      await win.loadURL(url);
      await wait(1200);
      await js(`(() => { const rolls = [${name === "wash" ? 0.1 : 0.9}, ${roll}]; const real = Math.random; Math.random = () => rolls.length ? rolls.shift() : real(); document.querySelector('button[title="browse"]').click(); return true; })()`);
      await wait(3500);
      await writeFile(join(__dirname, "shots", `app-browse-bd-${name}-${index + 1}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(`captured app-browse-bd-${name}-${index + 1}`);
    }
  }
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
