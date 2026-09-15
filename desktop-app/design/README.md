# ANIdesktop design notes

## Current design: atsu style (September 2026)

The renderer follows atsu.moe. The components in `../src/` are the current UI reference.

- One centred column, 1120px wide (`--container`), shared by the top bar and the page. Gutters grow on wide windows.
- Top bar: wordmark, a centred search pill (⌘K or / focuses it), then home, saved, recent, and settings icons. The bar
  carries nothing about playback: the corner player is the way back to the full player (its expand button or the
  backtick).
- Home: "Continue watching" and "Saved" as poster-card rows, eight across (six in narrower windows), with a next-episode badge and the audio mode. A schedule follows Saved and remains visible when the library is empty: the section head carries the season, the local zone, and plain-text Sunday–Saturday tabs with a dot under today; the body is the same poster-card grid, each card (titles reserve two lines on every card so the line beneath and the chips align across a row) showing an episode badge on the poster, then the local air time with a countdown for today's upcoming entries (or "Aired · time" once it has passed; posters that have not aired yet are darkened and desaturated, not faded, while aired ones stay at full brightness because they can be watched), and genre chips on one line: whole chips only, then a "+n" chip for the ones that did not fit (hovering it lists them). A plain-text SUB/DUB switch sits after the tabs behind a hairline; a card opens the series page.
  Arrow keys move between cards and rows, up and down also cross sections, Enter plays, o opens,
  x removes.
- Search: typing in the pill opens a palette over the page with a result count, and thumbnail rows
  carrying artwork and alternate titles. Up and down move, Enter opens, Escape clears and closes.
- Series: a sticky left panel with the poster, Play next, Save, and audio and quality chips. The right column has the
  title, source tags, a facts strip, then the episode list with All / Unwatched / Watched chips, a jump box, and sort
  arrows (newest first by default). Episodes are grouped by number with one row per provider. Each row shows the best
  quality that source offers, resolved lazily as rows scroll into view and cached in the app’s metadata store; the checkbox
  records progress through that episode on that provider.
- Sources are resolved together around a *work*, the app's own identity for an anime (`Work` in `shared/contracts.ts`,
  owned by `electron/state.ts`). Search groups provider records into one row per work (`unifyAnimeResults` in
  `shared/catalog.ts`, matching rules in `shared/identity.ts`) in three tiers that each run to completion before the
  next: a shared external reference (a MyAnimeList id HiAnime states, an AniList answer, the offline index, or a
  remembered work), then a shared normalised title or alias, then the same season of the same title. Season markers
  are compared strictly ("Part 2" is not "2nd Season", and "Part 6: Stone Ocean Part 2" is not "Part 6: Stone Ocean
  Part 3"); a format, year, or episode count that disagrees vetoes a match. Two records from one provider share a
  row only through a reference or a release qualifier such as "(Uncensored)". Rows show a chip per source and say
  "grouped by title" when the weakest tier joined them. Confident rows are remembered as works after each search.
  Opening a series looks it up on every provider it is not yet known on (`CatalogService.resolve`), using the
  work's known titles; confident matches bind to the work and their episodes join the grouped list as they arrive.
  The series page shows the work's information (`electron/work-info-service.ts`, from AniList, cached indefinitely
  and refreshed by age) under the facts strip: synopsis with a More toggle, related seasons as chips that start a
  search, and the source line with a Refresh info link. Each source tag carries a split control; splitting records
  the pair so title matching never regroups it. Settings has an "Anime information" group with the AniList switch
  and the offline title index switch and download. "Forget links" in the Sources group resets every work. There is
  no manual merge for search rows any more; the library cards keep theirs for duplicates saved before grouping.
- Saved and recent: full card grids filtered by the pill. Settings: grouped cards. The Sources group is one row per
  provider: a status dot with the name and a one-line state on the left, the address in a fixed middle column, and a
  single Check now / Retry button and an on/off switch on the right. A source that is off dims and is left out of search, lookup, and episode loading.
  The theme picker is a row of preview tiles, one per preset plus custom, each drawn in its own background, text,
  and highlight colours; custom adds a row of colour swatches with editable hex values.
  Yes/no settings (start fullscreen, autoplay, diagnostics) are switches; chips are reserved for choices between
  named options (player, quality, audio, preferred source). The cancel/save row sticks to the bottom of the scrolling
  form and save is disabled until something changes. The key-hint footer is gone; `?`
  shows a hint pill.
- Footer: one raised, rounded panel under every page (like the atsu.moe footer), and the only place the app describes itself. Left: the wordmark, a one-line blurb, a credit line saying the app is built on ani-cli by pystardust and its contributors (both linked), and a link to the source. Middle: an "App" column of icon links (home, saved, recent, settings) with the current one lit. Right: "Made by", one row per creator with a small round portrait, the name, and icon-only links (GitHub, Discord, Instagram, email; the Discord icon copies the handle and shows a "Copied" tip). A dim foot line carries the media note. There are no About or Contact pages.
- Type is the system sans-serif (Inter when installed); Fragment Mono is no longer bundled. Themes are unchanged.

## Capture the current UI

From `desktop-app/`, start `npx vite --host 127.0.0.1`, then run:

```sh
env -u ELECTRON_RUN_AS_NODE npx electron design/capture-app.cjs
```

The capture tool uses the in-memory development API. Generated screenshots go to `design/shots/`, which is ignored by Git.
Use `SHOT_WIDTH`, `SHOT_HEIGHT`, and `SHOT_SUFFIX` for other window sizes, or pass the development server URL as the first argument.

`design/capture-motion.cjs` works the same way but saves frame bursts (`design/shots/motion/`) around the moments that animate:
the home grid, the search palette, opening a series, the playback status, and docking or expanding the player.
