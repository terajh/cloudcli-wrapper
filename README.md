# Vienna

> A native macOS desktop wrapper for [claudecodeui](https://github.com/siteboon/claudecodeui), with a tighter chat UX, real token-by-token streaming, and a single-binary install.

Vienna runs the entire claudecodeui frontend + Express server inside a Tauri (Rust + WKWebView) shell so you get a real native window — title bar, traffic lights, drag, zoom, fullscreen, native menu, Cmd+/-/0 zoom — instead of a browser tab. Everything ships as one DMG + one runtime tarball; no `npm run build` is required at install time.

## Screenshots

<!-- Replace these with your own captures from the running app. -->

<p align="center">
  <img src="docs/screenshots/main.png" alt="Vienna main chat view" width="900" />
</p>

<p align="center">
  <img src="docs/screenshots/sidebar.png" alt="Sidebar with multi-project + threads-style sessions" width="320" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/streaming.png" alt="Token-by-token streaming with optimistic placeholder" width="560" />
</p>

## Install

Apple Silicon macOS, Node.js 18+ required:

```bash
curl -fsSL https://github.com/terajh/vienna/releases/download/v0.6.2/install.sh | bash
```

The installer:

1. Downloads `Vienna_0.6.2_aarch64.dmg` and `vienna-runtime-0.6.2.tar.gz` from the release.
2. Copies `Vienna.app` into `/Applications` and strips the macOS quarantine flag.
3. Extracts the runtime (pre-built `dist/` + Express server) into `~/.vienna/claudecodeui` — no `git clone`, no frontend build.
4. Runs `npm install --omit=dev --ignore-scripts` (skips dev-only `husky` etc.) and then explicitly runs `scripts/fix-node-pty.js` so PTY sessions work.
5. Backs up the previous install (with `auth.db`) before swapping in the new runtime.

After install, just open Vienna from Spotlight or `open /Applications/Vienna.app`.

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
