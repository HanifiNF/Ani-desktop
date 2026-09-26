// Records each variant of variants/notifications-motion.html running one scripted sequence, as MP4s in design/shots/motion/.
// The page runs at quarter speed (animations and the page's own timers) and every painted frame keeps its timestamp, so the video plays back at true speed without dropped frames.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/record-notifications-motion.cjs [now a b c]
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile, rm, link } = require("node:fs/promises");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

const RATE = 0.25;
const WIDTH = 1120, HEIGHT = 746;
const variants = process.argv.slice(2).filter((v) => ["now", "a", "b", "c"].includes(v));
const out = join(__dirname, "shots", "motion");
const page = pathToFileURL(join(__dirname, "variants", "notifications-motion.html")).href;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();
// Encoding happens after the window closes; keep the app alive until then.
app.on("window-all-closed", () => undefined);

// [caption, selector to click, hold in real milliseconds]
const STEPS = [
  ["", null, 500],
  ["Open the bell panel", ".bell", 1000],
  ["Close it", ".episode-updates-panel .act-close", 700],
  ["Open the page", '[data-do="replay"]', 1100],
  ["Delete a notification", ".notification-card .act-del", 1100],
  ["A new episode arrives", '[data-do="add"]', 1400],
  ["Mark all as read", ".act-all", 1100],
  ["Open the panel", ".bell", 800],
  ["Clear", ".act-clear", 1500]
];

async function record(variant) {
  const dir = join(out, `frames-${variant}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(60);
  await win.loadURL(`${page}?solo=${variant}`);
  await wait(1200);
  const js = (code) => win.webContents.executeJavaScript(code);
  // Hidden windows skip animation frames, so the rate is set through DevTools, which covers CSS and script animations alike.
  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Animation.enable");
  await win.webContents.debugger.sendCommand("Animation.setPlaybackRate", { playbackRate: RATE });
  await js(`window.clockRate = ${RATE}; true`);

  const frames = [];
  let start = 0;
  const writes = [];
  const keep = (image) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    frames.push({ file, at: Date.now() });
    writes.push(writeFile(file, image.toJPEG(92)));
  };
  win.webContents.on("paint", (_event, _dirty, image) => { if (start) keep(image); });
  start = Date.now();
  keep(await win.webContents.capturePage());

  const label = variant === "now" ? "Now" : variant.toUpperCase();
  for (const [caption, selector, hold] of STEPS) {
    await js(`document.querySelector(".on-air .tag").textContent = ${JSON.stringify(caption ? `${label} · ${caption}` : label)}; true`);
    if (selector && !(await js(`(() => { const el = document.querySelector(${JSON.stringify(`.on-air ${selector}`)}); if (el) window.tap(el); return Boolean(el); })()`))) throw new Error(`${variant}: nothing matches ${selector}`);
    await wait(hold / RATE);
  }
  const end = Date.now();
  await Promise.all(writes);
  win.destroy();

  // Resample to a steady 60 fps in real time: each tick shows the latest paint, linked rather than copied.
  const seq = join(dir, "seq");
  await mkdir(seq);
  const real = (at) => (at - start) * RATE;
  const total = real(end), ticks = Math.ceil(total / (1000 / 60));
  for (let tick = 0, i = 0; tick < ticks; tick++) {
    while (i + 1 < frames.length && real(frames[i + 1].at) <= tick * (1000 / 60)) i++;
    await link(frames[i].file, join(seq, `${String(tick).padStart(5, "0")}.jpg`));
  }
  const video = join(out, `notifications-${variant}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "60", "-i", join(seq, "%05d.jpg"), "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", video]);
  await rm(dir, { recursive: true, force: true });
  console.log(`recorded ${video} (${frames.length} paints)`);
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  for (const variant of variants.length ? variants : ["now", "a", "b", "c"]) await record(variant);
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
