# Watch Companion: Columbinya

## Summary

Add Columbinya as ANIdesktop's first built-in animated watch companion. She appears inside the app, reacts to meaningful browsing and playback actions with short preset speech bubbles, and never makes network or AI requests. The companion is enabled by default, can be turned off in Settings, and stays hidden during native fullscreen playback.

The supplied `pet.json` and `spritesheet.webp` are the source assets. The image is a transparent 1536 × 1872 WebP atlas: eight columns, nine rows, and 192 × 208 pixel cells. It is a legacy v1-style sheet; do not require the v2 look-direction rows or regenerate it. Bundle a copy under `desktop-app/public/pets/columbinya/` so development and packaged builds load the same asset. Keep a local typed animation manifest in the app rather than interpreting the supplied JSON as instructions.

## Experience and behavior

- Show a roughly 96 × 104 pixel companion at the lower left of Home, Browse, Saved, Recent, Series, and Settings. Keep it clear of page controls, the footer, and the docked mini player; when the mini player occupies that corner, move the companion to the opposite lower corner. On expanded windowed playback, place it at the upper right, away from captions and playback controls. Hide it during native fullscreen and temporary episode-opening states.
- Animate idle quietly. Use the atlas's `waving`, `review`, `waiting`, `failed`, and `jumping` rows for matching reactions; return to idle after one cycle. In reduced-motion mode, use the first frame of each state and do not run frame timers. Pause animation and bubble timers while the document is hidden.
- Show a bubble for about five seconds after a trigger. Keep text short, limit titles in bubbles to a readable length, and render all interpolated values as React text. A click on the pet shows a contextual preset line on demand; a close button dismisses the bubble without disabling the pet. The pet button has an accessible name and keyboard focus style.
- Use local English preset lines with a warm, light tone and no plot spoilers. Select a line from the event's preset pool without repeating the immediately previous line. Support safe `{title}` and `{episode}` placeholders where relevant.
- Trigger on opening a series, the first successful Browse or search action in a visit, saving a title, starting an episode, pausing after meaningful playback, finishing an episode, and a playback or source error. Do not trigger on each keystroke, time update, render, or background metadata response. If a title is reopened, a brief cooldown prevents repeated greetings.
- Apply one global 45-second cooldown to automatic bubbles and a five-minute cooldown per event and anime identity. Completion and errors may replace a lower-priority bubble immediately. User clicks bypass cooldown. Queue at most one pending automatic bubble, with the newest higher-priority event winning; discard stale queued events when the screen or episode changes. Do not create watch history or start playback from pet interaction.
- Add a small **Watch companion** control in Settings > Appearance: enabled switch, dialogue frequency (`Quiet`, `Normal`, `Chatty`), and a preview/"Say hello" action. Frequency changes only automatic cooldowns: 120, 45, or 20 seconds respectively. User-triggered clicks still work whenever the pet is enabled. Settings save through the existing settings flow and survive restart; older state files default to enabled and Normal.

## Implementation

- Add an internal typed `CompanionEvent` union and a preset dialogue table. Keep event creation at existing app actions in `App.tsx` and the built-in player callbacks in `PlayerScreen.tsx`. Pass a narrow event callback to the player; do not add Electron IPC or provider requests for this feature.
- Add a `WatchCompanion` overlay component at the app-shell level so page changes do not reset animation or cooldown state. Use a small frame renderer for the 8 × 9 atlas, with explicit row and frame-count data. Use the standard row order: idle 0, run right 1, run left 2, wave 3, jump 4, failed 5, waiting 6, working 7, review 8. Only states used by ANIdesktop need to play; unused transparent cells must never be shown.
- Normalize and validate companion preferences when loading and saving `Settings`. Do not alter bookmarks, history, positions, player preferences, or subtitle settings. Put no episode title or private playback details in persistent companion state or diagnostics.
- Position the overlay from app screen, native fullscreen state, mini-player presence/corner, and viewport width. Keep its wrapper pointer-transparent except the pet and bubble controls. On narrow windows, shrink the pet and bubble and clamp them inside the visible content area. Respect reduced motion and the active theme.
- Copy the user-supplied asset into the app's static assets and document its manifest and expected dimensions. The provided manifest names Columbinya but has no `spriteVersionNumber`; treat the measured 8 × 9 geometry as this built-in pet's fixed contract. Future pets can use a separate manifest and should not change this first version's event interface.

## Verification

- Unit-test frame row/count mapping and make sure animation never enters an unused cell; cover reduced motion and hidden-document behavior.
- Test preset selection, placeholder rendering, duplicate suppression, cooldown and priority rules, click-to-speak, dismissal, and stale-event cancellation.
- Test Settings defaults, validation, persistence, and migration from existing state without companion preferences.
- Verify series/search/Browse/save/play/pause/ended/error triggers, with no bubble for typing or time updates. Confirm pet interaction does not initiate playback or record history.
- Check normal pages, narrow windows, themes, docked mini-player corners, windowed playback, native fullscreen, keyboard focus, captions, player controls, and the temporary opening state on Windows and macOS.
- Run both typechecks and unit tests. Leave release builds, packaging, commits, and pushes to the user.

## Defaults and decisions

- The exact supplied Columbinya artwork is the first bundled companion.
- She is visible on ordinary app pages and expanded windowed playback, and hidden during native fullscreen playback.
- This version has one companion, preset English dialogue, no sound, no external AI service, and no separate desktop overlay window.
