// Run the production main process, preload and renderer with isolated state and fixture HTTP responses.
const { app, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { DEFAULT_STATE } = require('../dist-electron/shared/settings.js');

const directory = mkdtempSync(join(tmpdir(), 'ani-browse-integration-'));
const userData = join(directory, 'ani-desktop');
mkdirSync(userData);
app.setPath('appData', directory);
app.setPath('userData', userData);
app.setPath('sessionData', directory);
writeFileSync(join(userData, 'state.json'), JSON.stringify({ ...DEFAULT_STATE, settings: {
  ...DEFAULT_STATE.settings, emptyBackdrop: false, animeInfo: true, offlineIndex: false,
  disabledSources: ['anidb'], aniwaveBaseUrl: 'https://browse-fixture.test'
} }));
writeFileSync(join(userData, 'title-index.json'), JSON.stringify({ version: 1, updatedAt: Date.now(), entries: [
  { t: 'Hajime no Ippo', s: ['Fighting Spirit'], refs: ['anilist:263', 'mal:263'], y: 'TV', r: 2000, e: 75 }
] }));
const media = { id: 263, idMal: 263, title: { english: 'Hajime no Ippo: The Fighting!', romaji: 'Hajime no Ippo: THE FIGHTING!', native: 'はじめの一歩 THE FIGHTING!' },
  synonyms: ['The First Step', 'Fighting Spirit', 'Espíritu de lucha', 'Hajime no Ippo: A Luta!'], format: 'TV', seasonYear: 2000, status: 'FINISHED', episodes: 75,
  genres: ['Sports'], studios: { nodes: [] }, tags: [], relations: { edges: [] }, description: 'Browse discovery fixture.' };
const queries = [], calls = new Map();
let metadataSearches = 0, blockSources = false;
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, (...args) => {
  calls.set(channel, (calls.get(channel) ?? 0) + 1);
  return handler(...args);
});
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
global.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'graphql.anilist.co') {
    const body = JSON.parse(init.body);
    if (body.query.includes('GenreCollection')) return json({ data: { GenreCollection: ['Sports'] } });
    if (body.query.includes('MediaTagCollection')) return json({ data: { MediaTagCollection: [] } });
    if (body.query.includes('Page(perPage: 25)')) { metadataSearches++; return json({ data: { Page: { media: [media] } } }); }
    return json({ data: { Page: { media: [media], pageInfo: { hasNextPage: false } }, Media: media } });
  }
  if (url.pathname === '/filter' || url.pathname === '/api/search') {
    const provider = url.pathname === '/filter' ? 'aniwave' : 'hianime';
    const query = provider === 'aniwave' ? url.searchParams.get('keyword') : JSON.parse(init.body).title;
    queries.push({ provider, query });
    if (blockSources) return new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    const found = query === 'Fighting Spirit' || (provider === 'aniwave' && query === 'Hajime no Ippo');
    return provider === 'aniwave' ? new Response(found ? '<div class="item"><a class="name d-title" href="/watch/hajime-no-ippo-78818" data-jp="Hajime no Ippo">Fighting Spirit</a></div>' : '')
      : json(found ? [{ English: 'Fighting Spirit', Japanese: 'Hajime no Ippo', slugs: ['fighting-spirit-72xozg'] }] : []);
  }
  if (url.pathname.startsWith('/ajax/episode/list/')) return json({ result: '<a data-num="1"></a>' });
  if (url.pathname.startsWith('/api/anime/')) return json({ anime: { _id: '012345678901234567890123', totalEpisodes: 1, genres: [] } });
  if (url.pathname.startsWith('/api/episodes/')) return json({ episodes: [{ episodeNumber: 1, slug: 'ippo-episode-1' }] });
  // Metadata, schedule, availability and update checks are irrelevant to this fixture, and stay offline.
  return json({ result: '' });
};

let win;
const delay = ms => new Promise(done => setTimeout(done, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function waitFor(code) {
  for (let i = 0; i < 200; i++) { if (await evaluate(code)) return; await delay(25); }
  throw new Error(`Timed out: ${code}\n${await evaluate('document.body.innerText')}`);
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const entry = { title: media.title.english, titles: [media.title.english, media.title.romaji, media.title.native, ...media.synonyms], titleVariants: media.title,
  refs: ['anilist:263', 'mal:263'], type: 'TV', year: 2000, episodes: 75, status: 'finished' };

async function run() {
  await waitFor('!!document.querySelector(".icons button[title=browse]")');
  await click('.icons button[title=browse]');
  await waitFor('!!document.querySelector(".browse .card .hit")');
  assert.equal(queries.length, 0, 'Browsing must only load the AniList catalogue');
  await click('.browse .card .hit');
  await waitFor('document.querySelector(".series h1")?.textContent === "Fighting Spirit"');
  await waitFor('document.querySelectorAll("[data-episode]").length === 2');
  assert.equal(queries.length, 6);
  for (const provider of ['aniwave', 'hianime']) assert.deepEqual(queries.filter(item => item.provider === provider).map(item => item.query),
    [entry.title, 'The First Step', 'Fighting Spirit']);
  assert.equal(metadataSearches, 0);
  assert.equal(calls.get('catalog:resolve') ?? 0, 0, 'Series opening must not create another discovery budget');
  let state = JSON.parse(readFileSync(join(userData, 'state.json'), 'utf8'));
  assert.ok(state.works.some(work => work.refs.includes('anilist:263') && work.records.length === 2));
  console.log('PASS cold Browse open finds both sources and persists their identity');

  await click('.series .crumb');
  await waitFor('!!document.querySelector(".browse .card .hit")');
  await click('.browse .card .hit');
  await waitFor('!!document.querySelector(".series h1")');
  assert.equal(queries.length, 6);
  assert.equal(calls.get('catalog:resolve') ?? 0, 0);
  console.log('PASS remembered Browse open performs no source searches');

  await evaluate('window.aniDesktop.clearSourceLinks()');
  await evaluate('(async () => { const state = await window.aniDesktop.getState(); await window.aniDesktop.saveSettings({ ...state.settings, offlineIndex: true }); })()');
  queries.length = 0;
  const hinted = await evaluate(`window.aniDesktop.discoverBrowse(${JSON.stringify(entry)}, { id: 'hinted', refresh: true, checkNow: true })`);
  assert.equal(hinted.anime.sources.length, 2);
  assert.deepEqual(queries.filter(item => item.provider === 'aniwave').map(item => item.query), [entry.title, 'Hajime no Ippo']);
  assert.ok(queries.filter(item => item.provider === 'hianime').length <= 5);
  assert.equal(metadataSearches, 0);
  console.log('PASS enabled offline index supplies an exact-ID query hint through the real IPC handler');

  await evaluate('window.aniDesktop.clearSourceLinks()');
  blockSources = true; queries.length = 0;
  await evaluate(`window.discoveryOutcome = 'pending'; void window.aniDesktop.discoverBrowse(${JSON.stringify(entry)}, { id: 'cancelled', refresh: true }).then(() => { window.discoveryOutcome = 'resolved'; }, () => { window.discoveryOutcome = 'cancelled'; });`);
  for (let i = 0; i < 100 && queries.length < 2; i++) await delay(10);
  assert.equal(queries.length, 2);
  await evaluate("window.aniDesktop.cancelCatalog('cancelled')");
  await waitFor("window.discoveryOutcome === 'cancelled'");
  state = JSON.parse(readFileSync(join(userData, 'state.json'), 'utf8'));
  assert.equal(state.works.length, 0);
  assert.equal(queries.length, 2);
  console.log('PASS cancellation aborts source requests and prevents persistence');
}

app.on('browser-window-created', (_event, window) => {
  win = window;
  win.show = () => {}; // Exercise the real app without exposing a test window.
  win.webContents.once('did-finish-load', () => { void run().then(() => app.quit(), error => { console.error(error); app.exit(1); }); });
});
app.on('will-quit', () => { rmSync(directory, { recursive: true, force: true }); });
setTimeout(() => { console.error('Browse integration exceeded 45 seconds'); app.exit(1); }, 45_000).unref();
require(resolve(__dirname, '../dist-electron/electron/main.js'));
