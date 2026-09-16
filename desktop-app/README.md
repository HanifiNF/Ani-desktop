# ANIdesktop technical guide

See the [main README](../README.md) for the app overview, screenshots, and getting started. This guide covers desktop configuration, development, and troubleshooting.

ANIdesktop is an Electron desktop client built on the ani-cli v5 workflow. It supports AniWave/Vidplay, AniDB, and HiAnime, with automatic source selection. HLS video plays in a built-in Vidstack screen on Windows, macOS, and Linux; mpv, VLC, and IINA remain optional external fallbacks. The React renderer has no direct Node.js access.

## Creator photos

The footer looks for square creator photos at `public/creators/hanifi.webp` and `public/creators/pascal.webp`. It shows each creator's initial when a photo is absent. Add an optimized square WebP image at either path to replace that fallback without changing the component; JPEG files may also be used after updating the corresponding filename in `src/creators.ts`.

## Requirements

- Node.js 22 or newer
- npm, included with Node.js

No separate media player is required.

## Run from source

The app runs from source on Windows, macOS, and Linux:

```sh
cd desktop-app
npm install
npm start
```

`npm start` builds and launches the Electron app. Use `npm run dev` for the development server or `npx vite` for the renderer-only browser preview.

## Using the app

Type at least two characters to search automatically after a short pause, or press Enter to search immediately. Results, saved titles, and recent titles support mouse and keyboard navigation.

- Catalog search checks AniWave, AniDB, and HiAnime concurrently and shows one row per anime as each provider responds. Records are grouped by identity rather than by provider: a shared MyAnimeList or AniList id, a remembered work, a shared title or alias, or, as a last resort, the same season of the same title when no stated fact (format, year, episode count) disagrees. A provider's censored and uncensored copies of one anime share the row. Each row carries a chip per source; a row grouped by title alone says so. Results keep season, part, and special names visible. The preferred source setting controls playback selection.
- Every anime the app groups becomes a *work*: an app-owned identity that holds the external ids and the provider records bound to it. Bookmarks, history, and caches follow the work, so a provider can disappear or be replaced without losing what you watched. Confident groupings from search and the cross-source lookup that runs when a series opens are remembered automatically. On a series page, each source tag has a split control for a record that does not belong; the split pair is never grouped again by title. **Forget links** in Settings resets every work.
- Series pages show information for the work: format and season, airing status with the next episode date, studio, score, a synopsis, and genres. It comes from AniList, looked up by the work's ids or, for a work without ids yet, by its titles, and is cached locally: a finished series is fetched once and refreshed after about ninety days, an airing one after a day, or on **Refresh info**. Episode counts and lists always come from the streaming sources. Library entries saved before this existed learn their ids in a slow background pass shortly after start, a few at a time. The AniList switch in Settings turns these requests off; cached information and provider-scraped genres remain. An optional offline title index (a local copy of the anime-offline-database, about six megabytes, refreshed weekly) lets search group titles across sources without any request.
- Home shows the current seasonal schedule below Saved as a poster-card grid. It opens on today in the local Sunday–Saturday week, supports SUB/DUB, orders AniWave's estimated releases by local time, shows a countdown and one line of genre chips per card (with a "+n" chip for any that do not fit), and dims entries that have not aired yet while leaving aired ones at full brightness. AniWave must be enabled for live schedule updates; cached rows remain visible with a stale notice during an outage.
- Open a series to see episodes grouped by number, with provider sources underneath. Click an episode to play, use the sidebar to save or mark watched, and use **Jump to** to find an episode. This page uses mouse controls with standard Tab focus, without custom keyboard shortcuts or a selection highlight. Known and newly discovered sources populate independently, preserving scroll position.
- Supported sub/dub availability loads before full stream resolution. Audio labels describe provider-listed availability; playback verifies the host. Quality checks prioritize the selected episode and nearby visible rows. Failed checks offer **Retry info**.
- **Refresh sources** refreshes cached data while respecting paused services. Cached episode lists remain visible if a refresh fails, alongside the provider error. **Check now**, **Retry search**, and **Retry info** permit a controlled recovery check.
- The built-in player occupies the main window, with playback, seeking, volume, captions, quality, picture-in-picture, and native fullscreen controls. Escape docks it into a resizable corner player while you browse; click it to expand it again, or use backtick while browsing the library or search results. Video keeps its aspect ratio with black bars filling the remaining player area.
- Volume, mute, playback speed, caption visibility/language, and episode resume positions are saved locally. Positions use provider episode IDs and audio mode, so refreshed stream URLs resume correctly.
- Built-in episodes are recorded as started on opening and completed when playback reaches the end. Continue resumes an unfinished episode; completed episodes advance to the next one. Existing history retains its previous completed interpretation. External-player completion remains untracked and uses the existing launch-based history behavior.
- Clearing history also clears resume positions. Bookmarks, works and their source bindings, preferred quality, audio mode, and theme are stored locally.
- Settings control the playback target, instant fullscreen, external fallback path, provider addresses, and theme.
- Each source in Settings has a switch. A source that is off is left out of search, cross-provider lookup, and episode loading; at least one must stay on, and a preferred source that is switched off falls back to auto. Settings also shows each source's recent reachability, last check time, and retry delay. **Check now** or **Retry** checks that source through the existing outage protection. Opening Settings only reads local status; checks stop when you leave. Save address edits before checking them. HiAnime status follows its catalog API, and playback hosts retain separate outage tracking.

The player listens for shortcuts immediately after opening. Text fields, sliders, and menus keep their own keyboard navigation. **?** or **Help → Keyboard Shortcuts** opens the shortcut reference; **Playback** contains native menu commands. On Linux, Alt reveals the hidden menu bar.

| Shortcut | Action |
| --- | --- |
| Space / K | Play or pause |
| Left / Right / J / L | Seek 10 seconds |
| Shift + Left / Right | Seek 20 seconds |
| Up / Down | Adjust volume |
| M | Mute |
| C | Toggle captions |
| < / > | Change speed in 0.25× steps |
| 0–9 | Seek to 0–90% |
| I | Picture in picture |
| F / double-click | Native fullscreen |
| Ctrl+Cmd+F (macOS), F11 (Linux/Windows) | Native fullscreen |
| Escape | Close an open menu first, then leave fullscreen |
| Tab / Shift+Tab | Move between controls |

The startup fullscreen preference applies when starting a fresh built-in playback session in the main window. Selecting another episode preserves the current window mode. Fullscreen follows confirmed window-manager events and ignores repeated toggles during a transition. A failed transition displays a dismissible notice while playback continues.

On Windows, the app disables Chromium's DirectComposition surface and video-overlay paths at startup to prevent audio-only black frames when moving between the mini player, expanded player, and fullscreen. Other GPU acceleration and hardware decoding remain enabled. The mitigation takes effect after restarting the app and does not change macOS or Linux behavior.

For troubleshooting, turn **Settings → player diagnostics → on**, then save. This takes effect in an open player immediately and stays enabled across restarts until you turn it off and save. **Open logs** opens the local log folder. Logging is off by default.

`media-player.jsonl` contains timestamped JSON records grouped by playback session: the active rendering policy, key down/up, modifiers, repeats, focused control, whether the key's default action was prevented, seek requests and results, playback/buffering, volume, speed, track/quality changes, errors, native fullscreen, window size/focus, and renderer failures. Keyboard records include the input timestamp (`inputTime`, milliseconds since the Unix epoch) and playback position so they can be correlated with resulting media events. A prevented key alone does not prove that a seek succeeded; check the subsequent `seeked` record.

Logs live in the app's user-data `logs` folder. The single `media-player.jsonl` file retains the latest **five minutes** of events, with cleanup once per second while the app is open, including when diagnostics are turned off. Startup and **Open logs** also trim expired entries. Time-based retention replaces the size limit and backup rotation; any existing backup is merged into the five-minute window and removed. Files left while the app is closed are trimmed at the next launch. Log writing runs asynchronously with a bounded queue; a `dropped` count identifies records omitted under heavy load. Text-field/composition input, stream URLs, titles, and arbitrary error messages are excluded. Nothing is uploaded. To report an issue, enable diagnostics, reproduce it, then promptly copy the log file before those events expire.

If the built-in player reports a fatal error, use **Retry** to resolve a fresh stream URL for the episode. **Open in external player** is enabled when an external-player path is configured and is never triggered automatically.

## Optional external players

Choose **Settings → Playback → external**, or keep built-in playback selected and use the fallback button. The fullscreen/windowed preference applies to both targets.

For IINA on macOS, set the external path to:

```text
/Applications/IINA.app/Contents/MacOS/iina-cli
```

The app supplies the HLS format, referrer, media title, and fullscreen options required by IINA. Equivalent supported arguments are supplied to mpv and VLC.

## Themes and icons

Theme presets and custom colours control the interface and running app icon. Builds generate a graphite PNG, multi-size Windows ICO, and Retina-ready macOS ICNS from `../app-icon.svg`.

## Catalog loading

Works live in `state.json` alongside the library, capped at 5,000 with the oldest unreferenced works dropped first; works the library refers to are never dropped. Series information sits in `work-info.json`, keyed by MyAnimeList id, up to 5,000 works, kept indefinitely and refreshed by age as described above; AniList search answers used for grouping are kept there for a day. AniList requests honour the rate limit stated in its response headers and pause before reaching it. The offline title index, when enabled, is downloaded from the anime-offline-database releases to `title-index.json` and refreshed weekly at startup.

The Electron main process shares in-flight HTTP requests and caches their response bodies in memory (up to 1,000 entries and 32 MB). Search and server availability responses remain fresh for 60 seconds, episode-list responses for 30 seconds, and source/playlist responses for 20 seconds. Response-body caches reset when the app exits. Parsed episode catalogs persist in `episode-lists.json` for up to seven days and remain visible while providers refresh. That cache holds at most 200 provider catalogs and 20,000 episodes; invalid or expired saved entries are discarded on load.

Background traffic is limited to five active requests overall and two per service origin. Playback can use a reserved sixth slot and a third request to a service. Queued playback requests take priority. Cancellation releases an individual consumer; shared upstream work stops only when its last consumer leaves.

Network errors, timeouts, HTTP 429, and HTTP 5xx failures pause the affected service. Repeated failed recovery checks increase the pause from 30 seconds to 2 minutes, 5 minutes, then 15 minutes. After the pause, the next needed request acts as the sole recovery probe; other requests to that service fail promptly or use fresh cached responses. Probes make one HTTP attempt. Healthy services remain available, and a failing video host is tracked independently from its catalog provider. Missing records, unavailable audio, and user cancellations do not count as service outages. Concurrent results from before a pause cannot clear it or repeatedly increase its backoff.

Explicit retry actions may request one early check per service, shared by downstream lookups. Bulk refresh preserves outage protection. A server's `Retry-After` delay takes precedence, including for manual checks. Successful recovery resets the backoff. There is no idle polling: recovery checks run when data is next needed.

Outage counters and next-check times are saved atomically to `source-health.json` in Electron's user-data directory, with a limit of 100 service origins. They survive restarts and expire after 24 hours without a failure once the cooldown has elapsed. Cache refreshes and unrelated source-setting changes preserve this history; a different service address has separate health. Damaged health files are rebuilt automatically.

Episode audio availability and best resolution are saved to `episode-metadata.json` in Electron's user-data directory, keyed by source configuration and provider episode ID, with separate sub/dub resolutions. Successful resolutions and complete audio availability remain fresh for 24 hours. Missing audio or resolution is checked again after 15 minutes, so newly added versions can appear sooner. Fresh metadata restores without provider requests; expired metadata remains visible during viewport-driven refresh, including when a provider fails. Entries expire entirely after seven days, with a limit of 5,000 episodes. Writes are batched and atomic, and a damaged cache is rebuilt automatically.

The renderer holds up to 1,000 completed metadata entries and pauses failed lookups for 10 seconds. Work stops when rows leave the active view. **Refresh sources** clears metadata for the current series across both audio modes and forces new requests; **Retry info** forces another lookup for that row. Playback resolutions also update the metadata cache. Playable URLs continue using the short-lived memory cache and are resolved separately when playback starts.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

The real-player integration suite needs `ffmpeg` on PATH. It generates silent HLS fixtures in a temporary directory and uses an isolated Electron profile, leaving personal history untouched:

```sh
npm run test:player
npm run test:player:native
```

The first command tests actual Vidstack controls, HLS loading under the production CSP, captions, transient network recovery, resume across URL changes, and measured black bars. The second also opens a window and tests native fullscreen, window geometry, and application menus. CI configures macOS plus Linux X11/Openbox and Wayland/Weston runs. Compositor, multiple-display, and hardware media-key behavior should also be checked on the target desktop.

## Windows installer

```powershell
npm run dist:win
```

The x64 NSIS installer is written to `release/`.

## macOS packages

On macOS, build Intel and Apple Silicon DMGs with:

```sh
npm run dist:mac
```

The DMGs are written to `release/`. Apps use ad-hoc signing (`mac.identity: "-"`), with Electron's default hardened-runtime entitlements. The build mounts each completed DMG and verifies the app's signature, nested code, and CPU architecture before succeeding. Setting `identity` to `null` skips signing and can leave an invalid Electron signature after packaging.

These builds are unnotarized. A downloaded build may be blocked on first launch; after attempting to open it, a trusted user can approve it with **System Settings → Privacy & Security → Open Anyway**. Developer ID signing and Apple notarization are required for distribution that passes Gatekeeper without an override. The original `v0.1.0` Mac packages contain an invalid signature; install a newer build if macOS reports that version as damaged.

## Linux package

```sh
npm run dist:linux
```

The AppImage is written to `release/`. Linux runs through Electron on X11 or Wayland. For display-specific testing, pass `--ozone-platform=x11` or `--ozone-platform=wayland` to Electron.

## GitHub releases

Each push to `master`, including a merged pull request, starts the desktop release workflow. It runs the unit, build, and native player checks alongside builds of a Windows x64 installer, Linux x64 AppImage, and Intel and Apple Silicon macOS DMGs. Once all checks and packages succeed, it creates a version tag on the exact built commit and publishes the packages with generated release notes.

The first release uses the version in `package.json` (currently `0.1.0`). Each subsequent release increments the highest stable `vMAJOR.MINOR.PATCH` tag's patch number: `0.1.1`, `0.1.2`, and so on. To start a larger release, update the package and lockfile to a version above the latest release, then commit those files in your pull request:

```sh
cd desktop-app
npm version 0.2.0 --no-git-tag-version
```

The release version is applied to the package and lockfile in the build workspace. The workflow creates tags and releases using GitHub's built-in token; it creates no version-bump commits. The checked-in package version serves as the minimum version for future releases, so source checkouts can show an older version than downloaded packages.

Packaged apps check the repository's latest stable GitHub Release shortly after startup and at most once every 24 hours. An available version appears in a dismissible banner and in Settings; **View release** opens GitHub so the user can choose the appropriate installer. Checks never download or install files automatically. Results and per-version dismissals are stored in `update-check.json` in the app's user-data directory. Automatic checks are disabled while running from source, and **Check now** bypasses the daily throttle.

Release runs queue one at a time (up to GitHub's 100 pending-run limit). Failed checks or package builds prevent publication. Uploads stay in a draft until all files are attached. Retrying a tagged commit reuses its version and preserves an already published release. If a failed run's version was claimed by a later commit, choose **Re-run all jobs** to select a fresh version.

To test packages from a branch, open **Actions → Desktop release → Run workflow** and select the branch. Manual runs execute the same checks and builds and save the packages as workflow artifacts. Publication happens on pushes to `master`. macOS packages currently use ad-hoc signing; Developer ID signing and notarization can be added later.

Vidstack loads the bundled hls.js module directly, so the player requires no CDN script permission. Vidstack and hls.js are bundled JavaScript dependencies; no native player executable or streamed media is included. See [Third-party notices](THIRD_PARTY_NOTICES.md).

## Security boundary

The main window uses `contextIsolation`, disables Node integration, and communicates through a narrow preload API. Browsing and built-in playback share the `ani-desktop` nonpersistent Electron session. Referrer and CORS header adjustments apply to media/XHR traffic; poster and page requests retain their headers. Navigation, popups, and permission requests are blocked. Source requests and process launching remain in the main process; remote streaming pages are never loaded as application UI.

## Code layout

- `src/App.tsx` coordinates navigation, library state, series loading, and playback requests. `SettingsScreen`, `SeriesScreen`, `SearchPalette`, and `LibrarySection` render their respective views. `usePlayerSession` owns the native session subscription; `useAnimeSearch` and `useEpisodeMetadata` own their request lifecycles.
- `src/episodes.ts` and `src/library.ts` contain episode ordering, progress selection, and library models. `src/theme.ts` applies the active theme; `src/errors.ts` normalizes renderer-facing errors.
- `shared/settings.ts` defines defaults, playback quality choices, and catalog/source configuration keys. `shared/identity.ts` holds title normalisation, season markers, fact vetoes, and reference helpers; `shared/catalog.ts` groups provider records into works with them. `shared/player-diagnostics.ts` defines accepted diagnostic events.
- `electron/catalog-service.ts` is the catalog orchestration entry point for the app and smoke checks. `electron/scraper.ts` handles individual provider requests and stream resolution. `electron/anilist.ts` is the AniList client, `electron/work-info-service.ts` the series information cache, and `electron/identity-index.ts` the offline title index. `electron/state.ts` owns works and their bindings.
- Both TypeScript configurations reject unused locals and parameters. Unit tests cover the renderer and services; the player integration scripts exercise actual HLS playback in an isolated profile.

Current UI decisions and instructions for capturing the live renderer are in [design/README.md](design/README.md). Generated design screenshots are ignored by Git and excluded from application packages.
