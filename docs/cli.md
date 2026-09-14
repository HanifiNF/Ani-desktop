# ani-cli terminal guide

[← ANIdesktop](../README.md)

This repository retains a customized ani-cli v5 shell client with AniWave/Vidplay and AniDB provider adapters, bookmarks, downloads, and an optional Tkinter picker. See the [main README](../README.md) for ANIdesktop, the project's desktop application.

## Requirements

For terminal playback, install a POSIX shell, curl, grep, sed, fzf, and a supported media player such as mpv, VLC, or IINA. Additional tools depend on the feature:

- Downloads use yt-dlp or ffmpeg.
- The `--gui` picker requires Python with Tkinter and the bundled `ani-cli-gui.py` helper.
- `--skip` uses ani-skip with mpv.
- This fork's upstream update-and-merge mechanism requires Git.

Use a Unix-like shell on Linux or macOS, Termux on Android, or Git Bash on Windows. The [upstream ani-cli project](https://github.com/pystardust/ani-cli) documents platform-specific dependency setup. Package-manager versions of upstream ani-cli have their own feature set; use this checkout for this fork's provider and player changes.

## Run this fork

From the repository root, with dependencies installed:

```sh
./ani-cli naruto
./ani-cli --provider aniwave naruto
./ani-cli --provider anidb naruto
```

`--provider auto` is the default. It tries AniWave first and falls back to AniDB for search. ANIdesktop also supports HiAnime and combines search results across enabled providers.

For the bundled graphical picker:

```sh
./ani-cli --gui
```

Keep `ani-cli-gui.py` alongside the script, or set `ANI_CLI_GUI_SCRIPT` to its full path if you install the script elsewhere.

## Common options

| Command | Action |
| --- | --- |
| `./ani-cli --dub naruto` | Search for dubbed playback |
| `./ani-cli -q 720p naruto` | Request a preferred quality |
| `./ani-cli -e 5 naruto` | Choose an episode |
| `./ani-cli -b naruto` | Bookmark a selected title |
| `./ani-cli -B` | Open bookmarks |
| `./ani-cli -c` | Continue from history |
| `./ani-cli --remove-bookmark` | Select a bookmark to remove |
| `./ani-cli -d -e 1-3 naruto` | Download an episode range |
| `./ani-cli --vlc naruto` | Use VLC |
| `./ani-cli --help` | Show all options |

Downloads go to the current directory by default. Set `ANI_CLI_DOWNLOAD_DIR` to choose another location.

For IINA on macOS:

```sh
ANI_CLI_PLAYER="/Applications/IINA.app/Contents/MacOS/iina-cli" ./ani-cli
```

This fork passes the stream referrer and HLS decoding options to IINA. Copy the script from this checkout if you want those changes in an installed copy.

## Provider configuration

| Option | Environment variable | Purpose |
| --- | --- | --- |
| `--provider` | `ANI_CLI_PROVIDER` | Choose `auto`, `aniwave`, or `anidb` |
| `--aniwave-url` | `ANI_CLI_ANIWAVE_URL` | Set an AniWave-compatible base URL |
| `--source-url` | `ANI_CLI_BASE_URL` | Set an AniDB-compatible base URL |

Replacement addresses must expose the routes expected by their adapter.

## Updates and internals

Update your checkout to receive this fork's changes, then refresh any installed copy of the script. The CLI's `-U` option fetches upstream ani-cli and attempts to merge it with the customizations, saving a backup and leaving conflicts for review. That command applies to the shell script. For desktop updates, follow the [ANIdesktop README](../README.md#troubleshooting).

The [manual page](../ani-cli.1) and [hacking guide](../hacking.md) provide background on the CLI. Run `./ani-cli --help` for the options exposed by this checkout.
