# Vienna — Agent Guide

이 문서는 Vienna 저장소에서 작업하는 코딩 에이전트(Claude Code / Codex / Cursor 등)를 위한 레포 구조, 동작 원리, 개발/릴리즈 흐름 정리입니다. `CLAUDE.md`는 이 파일의 심볼릭 링크이므로 둘 중 어디를 읽어도 같습니다.

---

## 1. 프로젝트 한 줄 요약

Vienna는 [claudecodeui](https://github.com/siteboon/claudecodeui)를 macOS 네이티브 앱으로 감싸는 **Tauri v2 래퍼**입니다. Rust 셸이 Node.js Express 서버를 자식 프로세스로 띄우고, WKWebView가 그 서버(`http://127.0.0.1:5888`)를 로드해 React UI를 보여줍니다. `.app` 단독으로는 기능이 없고 `~/.vienna/claudecodeui/` 런타임이 반드시 필요합니다.

- **플랫폼**: macOS Apple Silicon (arm64) only
- **포트**: **`5888`** (하드코딩, `src-tauri/src/lib.rs:13` — `const SERVER_PORT: u16 = 5888`)
- **호스트**: `127.0.0.1` (`SERVER_HOST` 상수)
- **번들 ID**: `dev.vienna.desktop`
- **현재 버전**: `tauri.conf.json` + `src-tauri/Cargo.toml` 참조 (단일 소스 of truth)

---

## 2. 레포 구조

```
vienna/
├── src-tauri/                      # Rust + Tauri v2 셸
│   ├── src/lib.rs                  # 서버 spawn, native 메뉴, drag region, window lifecycle
│   ├── src/main.rs                 # minimal delegator
│   ├── tauri.conf.json             # productName, identifier, version, window, bundle
│   ├── Cargo.toml                  # vienna crate (version 반드시 tauri.conf.json 과 동기)
│   ├── capabilities/default.json   # core:window:allow-start-dragging 등
│   ├── icons/                      # 앱 아이콘 (32/128/256/512, .icns)
│   └── target/                     # cargo 빌드 산출물 (gitignore)
│
├── ui/                             # Tauri frontendDist — 로딩 화면 전용 minimal HTML
│   └── index.html                  # 서버 준비 전 잠깐 보이는 스피너
│
├── app/                            # claudecodeui 본체 (React 19 + Vite + Express + node-pty + SQLite)
│   ├── src/                        # React UI
│   │   ├── components/
│   │   │   ├── app/AppContent.tsx         # 최상단 레이아웃, title-bar drag region
│   │   │   ├── chat/                      # 채팅 UI + 스트리밍 tail isolation
│   │   │   ├── sidebar/                   # 프로젝트/세션 사이드바, 삭제 애니메이션
│   │   │   ├── main-content/              # 메인 패널 (chat/files/shell/git/tasks/preview)
│   │   │   └── standalone-shell/          # Provider CLI PTY 창
│   │   ├── hooks/                  # useProjectsState, useWebSocket, ...
│   │   ├── stores/useSessionStore  # 세션 슬롯 + promoteSession + peekSlot
│   │   └── i18n/                   # ko/en/ja/de/ru/zh-CN
│   ├── server/                     # Express + node-pty
│   │   ├── index.js                # 서버 엔트리 (포트 5888)
│   │   ├── claude-sdk.js           # Claude Agent SDK 연동 (stream_event unwrap)
│   │   ├── cursor-cli.js           # cursor-agent PTY
│   │   ├── openai-codex.js         # codex PTY
│   │   ├── gemini-cli.js           # gemini PTY
│   │   ├── providers/              # provider-agnostic NormalizedMessage
│   │   │   └── claude/adapter.js
│   │   └── routes/                 # /api/* HTTP 라우트
│   ├── package.json                # npm scripts: dev, build, typecheck, lint, start
│   ├── dist/                       # vite build 산출물 (gitignore, release 시 생성)
│   └── node_modules/               # gitignore
│
├── scripts/
│   ├── release.sh                  # 전체 release 빌드 (DMG + runtime tarball + bundle zip)
│   └── install-bundled.sh          # Vienna-installer-X.Y.Z.zip 안에 들어가는 자급 installer
│
├── install.sh                      # curl 기반 원격 installer (release 에 그대로 업로드)
├── release-output/                 # release.sh 산출물 (gitignore)
├── docs/screenshots/               # README 용 앱 캡쳐 자리
├── README.md                       # 사용자용 설치/소개 문서
├── AGENTS.md                       # ← 이 파일
└── CLAUDE.md                       # AGENTS.md 심볼릭 링크
```

### 레포가 "모노레포" 인 이유

v0.6.0 부터 claudecodeui fork(`terajh/claudecodeui`)를 이 레포의 `app/` 디렉토리로 import 했습니다. 즉 **Tauri 셸과 claudecodeui 본체가 하나의 레포에서 관리**됩니다. claudecodeui 업스트림(`siteboon/claudecodeui`) 동기화는 수동 patch로 이뤄집니다 (정기 sync 없음).

---

## 3. 런타임 아키텍처

```
사용자 더블클릭 Vienna.app
       │
       ▼
┌──────────────────────────┐
│ src-tauri/src/lib.rs     │  ← Rust Tauri 셸 (WKWebView + 네이티브 메뉴)
│   • setup()              │
│   • spawn_server()       │  ── spawn node ~/.vienna/claudecodeui/server/index.js
│   • wait_for_server      │
│   • webview.navigate()   │     http://127.0.0.1:5888 로 리다이렉트
└──────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│ app/server/index.js      │  ← Express + node-pty + WebSocket + SQLite
│   • GET  /               │     ─ dist/index.html 서빙
│   • WS   /ws             │     ─ 채팅/쉘/git 양방향 메시지
│   • POST /api/sessions   │     ─ 세션 CRUD
│   • providers/claude     │     ─ Claude Agent SDK stream_event unwrap
└──────────────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Claude / Cursor / Codex  │  ← provider CLI 서브프로세스 (PTY)
│ Gemini CLIs              │
└──────────────────────────┘
```

### 주요 경로

| 항목 | 경로 |
|---|---|
| Vienna.app 설치 위치 | `/Applications/Vienna.app` |
| 런타임 (서버 + dist + node_modules) | `~/.vienna/claudecodeui/` |
| 사용자 DB (auth, session) | `~/.vienna/auth.db` (Vienna가 env `DATABASE_PATH`로 주입) |
| 서버 로그 | `~/Library/Logs/Vienna/server.log` |
| claudecodeui .jsonl 세션 파일 | `~/.claude/projects/<project>/<sessionId>.jsonl` (Claude SDK 관리) |

### 환경 변수 (Vienna가 spawn 시 주입)

- `SERVER_PORT=5888`, `HOST=127.0.0.1`, `NODE_ENV=production`
- `DATABASE_PATH=~/.vienna/auth.db`
- `PATH` — interactive zsh PATH + `~/.local/bin` + `~/.cargo/bin` + `/opt/homebrew/bin` + `/usr/local/bin` 병합
- `CLAUDECODE`, `CLAUDE_CODE_*`, `ANTHROPIC_*` 환경변수는 **명시적으로 제거** (부모 셸에서 새어 들어오면 Claude SDK가 "nested session" 에러로 즉시 exit)

---

## 4. 개발 모드 실행

### 전제 조건

- macOS Apple Silicon
- Rust + `cargo tauri` (`cargo install tauri-cli --version "^2"`)
- Node.js **v20+** (NVM 권장, `.nvmrc` 없음)
- pnpm 또는 npm

### 개발 중 추천 방식 — `app/` 만 띄워서 브라우저에서 작업

```bash
cd app
pnpm install           # 첫 실행만
pnpm dev               # Express 서버 + Vite dev 서버 모두 기동
# → http://localhost:5173 (Vite HMR)
# → http://localhost:5888 (Express API + WS)
```

빠른 이터레이션용. React 수정만 할 때는 이게 압도적으로 빠릅니다.

### Vienna 셸까지 붙여서 실제 동작 확인

```bash
# 1. app/ 빌드 (dist 생성)
cd app && pnpm build && cd ..

# 2. Tauri 개발 모드
cargo tauri dev
```

**중요**: Vienna는 `~/.vienna/claudecodeui/` 를 runtime으로 바라봅니다. 개발 머신에서는 심볼릭 링크로 dev tree 를 가리키게 해두는 게 편리합니다:

```bash
rm -rf ~/.vienna/claudecodeui
ln -s /Users/carter.p/Dev/kakao/vienna/app ~/.vienna/claudecodeui
```

이 상태면 `app/` 에 변경 → `pnpm build` → **Vienna 창 Cmd+R 새로고침** 만으로 새 dist가 반영됩니다. `install.sh` 와 `scripts/install-bundled.sh` 둘 다 이 symlink 를 감지하면 runtime 교체를 건너뜁니다.

### 타입체크 / 린트

```bash
cd app
pnpm typecheck         # tsc --noEmit -p tsconfig.json
pnpm lint              # eslint
```

### 서버만 단독 실행 (디버깅용)

```bash
cd app
SERVER_PORT=5888 DATABASE_PATH=~/.vienna/auth.db node server/index.js
```

---

## 5. 릴리즈 빌드

### `scripts/release.sh` 한 방 빌드

```bash
cd /Users/carter.p/Dev/kakao/vienna
bash scripts/release.sh
```

버전은 `src-tauri/tauri.conf.json` 의 `version` 필드에서 자동 추출합니다. `VIENNA_VERSION=vX.Y.Z bash scripts/release.sh` 로 override 가능.

단계:

1. `cargo tauri build` → `src-tauri/target/release/bundle/{macos,dmg}/`
2. `(cd app && npm install && npm run build)` → `app/dist/`
3. `app/` 을 rsync 로 staging 에 복사 (node_modules/.git/*.db/*.env 제외)
4. staging 의 `package.json` 에서 dev-only lifecycle hook (`prepare` 등) 제거 → husky 때문에 install 실패하는 것 방지
5. `claudecodeui-runtime-X.Y.Z.tar.gz` 생성 → `release-output/vienna-runtime-X.Y.Z.tar.gz`
6. `install.sh` 를 `release-output/install.sh` 로 복사
7. Stage 5 (자급 번들): `install-bundled.sh` + `Vienna.app` + `npm install --omit=dev` 된 staging 디렉토리를 `zip -qry --symlinks` 로 묶어 `Vienna-installer-X.Y.Z.zip` 생성

### 환경 변수로 부분 재빌드

| env | 효과 |
|---|---|
| `VIENNA_VERSION=vX.Y.Z` | 버전 override (기본: tauri.conf.json) |
| `SKIP_TAURI=1` | 이전 DMG 재사용, Rust 재컴파일 생략 |
| `SKIP_NPM_INSTALL=1` | `app/node_modules` 재사용, 시간 단축 |

예: tarball만 재생성 → `SKIP_TAURI=1 SKIP_NPM_INSTALL=1 bash scripts/release.sh`

### 최종 산출물 (`release-output/`)

| 파일 | 크기 | 용도 |
|---|---|---|
| `Vienna_X.Y.Z_aarch64.dmg` | ~3.4MB | DMG 이미지 (Tauri 기본 번들) |
| `vienna-runtime-X.Y.Z.tar.gz` | ~5.5MB | curl 기반 installer용 런타임 tarball |
| `install.sh` | ~10KB | `curl \| bash` 스크립트 (release 에 그대로 업로드) |
| `Vienna-installer-X.Y.Z.zip` | ~136MB | 자급 번들 (Choonnobi 패턴, 더블클릭 설치) |

---

## 6. GitHub release 업로드

수동 업로드는 현재 `gh` CLI 없이 GitHub API 를 `curl` 로 직접 호출하는 방식입니다. PAT는 keychain 에 저장되어 있습니다:

```bash
PAT=$(security find-internet-password -s github.com -a terajh -w)
```

### release 생성

```bash
curl -sS -X POST -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/terajh/vienna/releases \
  -d '{"tag_name":"v0.6.x","target_commitish":"develop/tauri","name":"Vienna v0.6.x","body":"...","draft":false,"prerelease":false}'
```

응답의 `id` 를 `RID` 로 저장.

### asset 업로드

```bash
OUT=release-output
for f in Vienna_0.6.x_aarch64.dmg vienna-runtime-0.6.x.tar.gz install.sh Vienna-installer-0.6.x.zip; do
  case "$f" in
    *.dmg)  CT="application/x-apple-diskimage";;
    *.tar.gz) CT="application/gzip";;
    *.sh)   CT="text/x-shellscript";;
    *.zip)  CT="application/zip";;
  esac
  curl -sS -X POST -H "Authorization: token $PAT" -H "Content-Type: $CT" \
    --data-binary "@$OUT/$f" \
    "https://uploads.github.com/repos/terajh/vienna/releases/$RID/assets?name=$f"
done
```

### asset 교체 (같은 이름 재업로드)

GitHub 은 같은 이름의 asset 을 두 번 올릴 수 없습니다. 먼저 DELETE 후 재업로드:

```bash
ASSET_ID=$(curl -sS -H "Authorization: token $PAT" \
  "https://api.github.com/repos/terajh/vienna/releases/$RID/assets" \
  | python3 -c "import sys,json; print([a['id'] for a in json.load(sys.stdin) if a['name']=='<filename>'][0])")
curl -sS -X DELETE -H "Authorization: token $PAT" \
  "https://api.github.com/repos/terajh/vienna/releases/assets/$ASSET_ID"
# 그 후 다시 POST
```

---

## 7. 설치 플로우 (사용자 관점)

두 가지 지원됩니다. 상세는 `README.md` 참조.

### Option A: 자급 번들 (권장)

1. `Vienna-installer-X.Y.Z.zip` 다운 (136MB)
2. Finder 더블클릭으로 압축 해제 → `Vienna-installer-X.Y.Z/` 폴더 생성
3. 폴더 안 `install.sh` 더블클릭 (**첫 실행만 우클릭 → 열기** — Gatekeeper 1회 우회)
4. 자동 설치 + 실행

`scripts/install-bundled.sh` 가 실제 실행되는 내용입니다. Choonnobi 패턴을 따라 "옆 파일 이식 + 자기 폴더 삭제" 방식.

### Option B: 터미널 한 줄

```bash
curl -fsSL https://github.com/terajh/vienna/releases/download/v0.6.x/install.sh | bash
```

`install.sh` (repo root) 가 실행되어 GitHub release 에서 DMG + tarball 받아 설치. Gatekeeper 우회 불필요 (pipe 된 stdin 스크립트는 quarantine 대상 아님). 단 설치 시점에 `npm install --omit=dev --ignore-scripts` + `node scripts/fix-node-pty.js` 가 실행되어 node 가 필요합니다.

### 두 설치 모두 공통

- 기존 `~/.vienna/claudecodeui/` → `claudecodeui.backup-YYYYMMDD-HHMMSS/` 로 백업 후 교체
- backup 에서 `auth.db` 자동 복원 (로그인 세션 유지)
- 심볼릭 링크로 dev tree 를 가리키면 runtime 교체 **건너뜀** (개발자 보호)

---

## 8. 자주 손대는 파일 Top 10

| 파일 | 역할 |
|---|---|
| `src-tauri/src/lib.rs` | 서버 spawn, 네이티브 메뉴, drag region, 윈도우 lifecycle, Claude 환경변수 정리 |
| `src-tauri/tauri.conf.json` | 버전, window(`titleBarStyle: "Overlay"` + `hiddenTitle`), bundle |
| `src-tauri/capabilities/default.json` | window 권한 (start-dragging, toggle-maximize, set-fullscreen 등) |
| `app/server/index.js` | PTY spawn (provider CLI pre-flight 포함), WebSocket, API 라우트 |
| `app/server/claude-sdk.js` | Claude Agent SDK 통합 (`includePartialMessages: true` + stream_event unwrap) |
| `app/src/components/app/AppContent.tsx` | 레이아웃 root, `data-tauri-drag-region` 상단 28px strip |
| `app/src/components/sidebar/` | 프로젝트/세션 사이드바 (slide-out 삭제, 펼침/접힘 애니메이션) |
| `app/src/components/chat/hooks/useChatSessionState.ts` | 메인 세션 로딩 effect, streaming tail isolation, lifecycle phase 가드 |
| `app/src/stores/useSessionStore.ts` | 세션 슬롯 + `promoteSession` (temp→real) + `peekSlot` + placeholder filter |
| `app/src/hooks/useProjectsState.ts` | projects state, optimistic sidebar, delete flicker 방지 |

---

## 9. 이전 세션에서 해결한 이슈들 (회귀 방지 체크리스트)

작업할 때 다음 영역을 건드리면 특히 신중히:

- **Temp→real 세션 ID 전환 race** — `useChatSessionState.ts:327` 의 4중 가드 (phase / id+store / pendingViewSessionRef 5s window / store has streaming). `peekSlot` 로 체크하되 side-effect 있는 `getSlot` 호출 금지.
- **세션 삭제 깜빡임** — `useProjectsState.ts` 의 `recentlyDeletedSessionsRef` (8s window) + `projects_updated` handler 의 strip 로직. backend 의 stale broadcast 가 row 를 재등장시키지 않도록.
- **스트리밍 tail isolation** — `useChatSessionState` 에서 `stableChatMessages` vs `tailChatMessage` 분리. visible list 는 streaming 중 referential 안정.
- **Native 메뉴 단축키** (Cmd+=, Cmd+-, Cmd+0) — `lib.rs` 의 `view_submenu` + `on_menu_event`. webview eval 로 `window.__vienna_apply_zoom__` 호출.
- **Window drag** — `AppContent.tsx` 의 `data-tauri-drag-region` 28px strip + `capabilities/default.json` 의 `core:window:allow-start-dragging` 권한. 둘 다 있어야 드래그가 동작합니다.
- **Claude SDK nested session 에러** — `lib.rs:spawn_server` 에서 `CLAUDECODE`, `CLAUDE_CODE_*`, `ANTHROPIC_*` 환경변수를 전부 `env_remove`. 새 환경변수 추가 시에도 동일하게 처리.
- **Provider CLI pre-flight** — `server/index.js` 의 shell command 빌드 직전에 `command -v <binary>` 로 존재 확인 후 없으면 친절한 안내. `spawnSync` 는 `shell: true` 일 때 명령을 **한 문자열**로 전달해야 합니다 (`['arg1','arg2']` 별도 args 는 sh positional args 가 됨).

---

## 10. Git 워크플로우

### 브랜치

- `develop/tauri` — **현재 default branch**. 모든 작업이 여기에 commit + push.
- `main` — upstream claudecodeui sync 지점. 거의 사용 안 함.

### 커밋 스타일

Conventional commits. 영역 prefix 사용:

- `feat(sidebar): ...`, `fix(install): ...`, `perf(chat): ...`, `docs: ...`, `release: ...`, `chore: ...`

`--no-verify` 로 pre-commit hook 건너뛰기 (husky 가 node 버전 이슈로 실패할 수 있음).

### Git identity

```
user.name  = terajh
user.email = terajoohyun@ajou.ac.kr
```

local config 로 설정되어 있어야 합니다. `git config user.name` 으로 확인. 회사 계정(`kakao-carter-p`)이 섞이지 않게 주의.

### 푸시

PAT 를 URL 에 embed 해서 one-shot push (credential helper 사용 안 함):

```bash
PAT=$(security find-internet-password -s github.com -a terajh -w)
git push "https://terajh:${PAT}@github.com/terajh/vienna.git" develop/tauri
```

---

## 11. 자주 쓰는 명령 요약

```bash
# 프론트 타입체크 + 빌드
cd app && pnpm typecheck && pnpm build

# 풀 빌드 (DMG + tarball + bundle zip)
bash scripts/release.sh

# 빠른 부분 빌드 (tarball + bundle 만)
SKIP_TAURI=1 bash scripts/release.sh

# Vienna 재시작 (dev)
pkill -9 -x Vienna; pkill -9 -f "vienna/app/server"; sleep 2; open /Applications/Vienna.app

# 서버 로그 확인
tail -f ~/Library/Logs/Vienna/server.log

# 서버 health check
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5888

# Node v24 에서 native binding rebuild (v20 -> v24 ABI mismatch 시)
cd app && /Users/carter.p/.nvm/versions/node/v24.3.0/bin/npm rebuild better-sqlite3
```

---

## 12. 알려진 함정

1. **`~/.vienna/claudecodeui` symlink 를 끊으면 dev tree 접근 불가**. 복구: `ln -s /Users/carter.p/Dev/kakao/vienna/app ~/.vienna/claudecodeui`
2. **Vienna spawn 이 Node v24 를 쓰는 경우 v20 빌드된 better-sqlite3 는 로드 실패** — `ABI mismatch`. 위 rebuild 명령으로 해결.
3. **Vienna 셸이 종료 요청에 늦게 반응** — `pkill -9 -x Vienna` + 별도로 `pkill -9 -f "vienna/app/server"` 를 둘 다 실행해야 자식 node 까지 죽음.
4. **Gatekeeper 는 unsigned 스크립트를 첫 실행 시 무조건 차단** — Apple Developer Program 가입 + notarize 없이는 피할 수 없음. Option B (curl pipe) 나 "우클릭 → 열기" 1회 우회로 대응.
5. **기존 Vienna 볼륨이 마운트돼 있으면 DMG 재빌드 실패** — `hdiutil detach /Volumes/Vienna -force` 로 먼저 정리.
6. **`spawnSync({shell:true})` 에 args 배열을 주면 args 가 sh positional args 로 먹힘** — 전체 명령을 단일 문자열로 주세요.

---

## 13. 외부 레퍼런스

- claudecodeui 업스트림: https://github.com/siteboon/claudecodeui
- Tauri v2 docs: https://v2.tauri.app/
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`): https://docs.anthropic.com/en/docs/claude-code/sdk
- Vienna GitHub: https://github.com/terajh/vienna
