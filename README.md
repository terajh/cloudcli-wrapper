# Vienna

> A native macOS desktop wrapper for [claudecodeui](https://github.com/siteboon/claudecodeui), with a tighter chat UX, real token-by-token streaming, and a single-binary install.

Vienna runs the entire claudecodeui frontend + Express server inside a Tauri (Rust + WKWebView) shell so you get a real native window — title bar, traffic lights, drag, zoom, fullscreen, native menu, Cmd+/-/0 zoom — instead of a browser tab. Everything ships as one DMG + one runtime tarball; no `npm run build` is required at install time.

## Screenshots

<!-- Replace these with your own captures from the running app. -->
<img width="1840" height="1195" alt="image" src="https://github.com/user-attachments/assets/104658f1-e3af-47d9-b0de-2ca3ecde4cfe" />


## Install

Apple Silicon macOS only. Choose one of the two paths.

### Option A — bundled installer (recommended, no terminal, no internet during install)

1. Download [`Vienna-installer-0.6.2.zip`](https://github.com/terajh/vienna/releases/download/v0.6.2/Vienna-installer-0.6.2.zip) (~136MB) from the release.
2. Double-click the zip in Finder → it extracts a `Vienna-installer-0.6.2/` folder.
3. Inside that folder, double-click **`install.sh`**.
   - **First-time Gatekeeper warning** ("could not be verified") is normal for unsigned scripts. Bypass once: right-click `install.sh` → **Open** → confirm. After this any future download from the same machine works without the dialog.
4. A Terminal window opens, the installer copies `Vienna.app` into `/Applications`, drops the runtime into `~/.vienna/claudecodeui`, and launches Vienna. Done.

The zip already contains everything: the `Vienna.app` shell, the prebuilt React frontend, the Express server, and a `node_modules/` with production dependencies (including the native `node-pty` and `better-sqlite3` binaries). **No `npm install`, no internet, no `git clone` happens during install.**

### Option B — terminal one-liner (smaller download, needs internet)

```bash
curl -fsSL https://github.com/terajh/vienna/releases/download/v0.6.2/install.sh | bash
```

This variant downloads `Vienna_0.6.2_aarch64.dmg` (3.4MB) + `vienna-runtime-0.6.2.tar.gz` (5.5MB) on the fly and runs `npm install --omit=dev` on your machine. Smaller download, but needs npm + internet. There's no Gatekeeper dialog because piped-from-stdin shell scripts are not subject to quarantine.

### What the installer does

1. Stops any running `Vienna` process.
2. Copies `Vienna.app` into `/Applications` and clears the macOS quarantine flag.
3. Drops the runtime (`Vienna.app` shell + prebuilt React frontend + Express server + `node_modules/`) into `~/.vienna/claudecodeui`.
4. Restores `auth.db` from any previous install so logged-in sessions survive upgrades.
5. Launches `/Applications/Vienna.app`.

## Features

- **Native macOS shell** — title bar drag + double-click zoom, traffic lights, native menu (`Cmd+=` / `Cmd+-` / `Cmd+0` zoom), full screen.
- **Token-by-token streaming** — `includePartialMessages: true` on the Claude Agent SDK, ~30 fps flush, streaming-tail isolation so 1000+ message sessions stay smooth.
- **Optimistic UX** — assistant placeholder appears the moment you press Send, sidebar sessions appear immediately on first turn, deletes slide out instead of popping.
- **Reinforced session lifecycle** — promote temp→real session id without ever blanking the chat, 4-guard reinforcement against the temp/real swap race.
- **Threads-style sidebar** — folder + indented session rows, hover-only trash, provider logo + relative time on each row, 10-row default with inline more/collapse, smooth expand/collapse animation.
- **CLI pre-flight** — Claude / Cursor / Codex / Gemini login modal checks the binary is on `PATH` first and shows a coloured install hint instead of `bash: cursor-agent: command not found`.
- **Single-repo monorepo** — claudecodeui source lives under `app/` in this repo, no submodule, no second fork to maintain. Build and release are done by a single `scripts/release.sh`.

## Repo layout

```
vienna/
├── src-tauri/                     # Rust + Tauri shell (window, menu, server spawner)
│   ├── src/lib.rs                 # spawn ~/.vienna/claudecodeui/server/index.js + manage lifecycle
│   ├── tauri.conf.json
│   └── capabilities/default.json  # window:start-dragging, toggle-maximize, ...
├── ui/                            # tiny loading screen shown until the server is ready
├── app/                           # claudecodeui (React + Vite + Express + node-pty + SQLite)
├── scripts/release.sh             # builds DMG + vienna-runtime tarball + stages install.sh
├── install.sh                     # what users curl from a release
└── README.md
```

## Build from source

You need Rust (`cargo`), `cargo tauri`, Node.js 18+, and `pnpm` (or `npm`).

```bash
git clone https://github.com/terajh/vienna.git
cd vienna

# build the React frontend (vienna/app)
cd app
pnpm install
pnpm build
cd ..

# build the Tauri shell
cd src-tauri
cargo tauri build
# → src-tauri/target/release/bundle/dmg/Vienna_<version>_aarch64.dmg
# → src-tauri/target/release/bundle/macos/Vienna.app
```

Or run the all-in-one release builder:

```bash
./scripts/release.sh
# → release-output/
#     Vienna_<version>_aarch64.dmg
#     vienna-runtime-<version>.tar.gz
#     install.sh
```

`scripts/release.sh` accepts:

| env | meaning |
|-----|---------|
| `VIENNA_VERSION` | override the version tag (defaults to `tauri.conf.json`) |
| `SKIP_TAURI=1` | skip the Tauri (DMG) rebuild and reuse the previous DMG |
| `SKIP_NPM_INSTALL=1` | reuse `app/node_modules` instead of running `npm install` |

## Uninstall

```bash
rm -rf /Applications/Vienna.app
rm -rf ~/.vienna
```

## License

claudecodeui is GPL-3.0 (see `app/LICENSE`). The Tauri shell + scripts in this repo are released under the same license to stay compatible.
