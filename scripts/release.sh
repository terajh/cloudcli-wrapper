#!/usr/bin/env bash
#
# Vienna release builder
#
# 1. Tauri 셸을 cargo tauri build 로 컴파일 → DMG
# 2. app/ (claudecodeui) 의존성 설치 + 프론트엔드 빌드 → app/dist/
# 3. app/ 디렉토리를 runtime tarball 로 압축 (node_modules / *.db / *.env 제외)
# 4. release-output/ 에 모든 산출물 배치
#
# 환경변수:
#   VIENNA_VERSION   tag/version (기본: src-tauri/tauri.conf.json 에서 읽음)
#   SKIP_TAURI       1 이면 cargo tauri build 건너뜀 (DMG 재사용)
#   SKIP_NPM_INSTALL 1 이면 app/ 에서 npm install 건너뜀
#
# 사용법:
#   ./scripts/release.sh             # 전체 빌드
#   SKIP_TAURI=1 ./scripts/release.sh  # tarball 만 다시 만들기

set -euo pipefail

# ─────────────────────────────────────────────
# 경로 / 설정
# ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIENNA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$VIENNA_DIR/app"
TAURI_DIR="$VIENNA_DIR/src-tauri"
OUTPUT_DIR="$VIENNA_DIR/release-output"
STAGING_DIR="$VIENNA_DIR/release-staging"

VERSION="${VIENNA_VERSION:-$(grep '"version"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')}"
DMG_NAME="Vienna_${VERSION}_aarch64.dmg"
TARBALL_NAME="claudecodeui-runtime-${VERSION}.tar.gz"

# 색상
BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
info() { echo "${BLUE}[INFO]${RESET} $*"; }
ok()   { echo "${GREEN}[ OK ]${RESET} $*"; }
warn() { echo "${YELLOW}[WARN]${RESET} $*"; }
err()  { echo "${RED}[ERR ]${RESET} $*" >&2; }

echo ""
echo "${BOLD}Vienna release builder — v${VERSION}${RESET}"
echo ""

# ─────────────────────────────────────────────
# 0. 사전 점검
# ─────────────────────────────────────────────
if [ ! -d "$APP_DIR" ]; then
  err "app/ 디렉토리가 없습니다: $APP_DIR"
  exit 1
fi
if [ ! -f "$APP_DIR/package.json" ]; then
  err "app/package.json 이 없습니다. claudecodeui 소스가 import 되지 않은 듯합니다."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  err "cargo 가 PATH 에 없습니다. \$HOME/.cargo/bin 을 PATH 에 추가하세요."
  exit 1
fi
if ! command -v cargo-tauri >/dev/null 2>&1; then
  err "cargo-tauri 가 없습니다. cargo install tauri-cli --version '^2'"
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  err "node / npm 이 PATH 에 없습니다. nvm use v20+ 후 다시 실행하세요."
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

# ─────────────────────────────────────────────
# 1. Tauri 셸 빌드 (DMG)
# ─────────────────────────────────────────────
if [ "${SKIP_TAURI:-0}" = "1" ]; then
  warn "SKIP_TAURI=1 — cargo tauri build 건너뜀"
else
  info "cargo tauri build..."
  ( cd "$VIENNA_DIR" && cargo tauri build )
  ok  "Tauri 빌드 완료"
fi

DMG_SOURCE="$TAURI_DIR/target/release/bundle/dmg/$DMG_NAME"
if [ ! -f "$DMG_SOURCE" ]; then
  err "DMG 가 없습니다: $DMG_SOURCE"
  exit 1
fi
cp "$DMG_SOURCE" "$OUTPUT_DIR/$DMG_NAME"
ok "DMG 복사: $OUTPUT_DIR/$DMG_NAME ($(du -h "$OUTPUT_DIR/$DMG_NAME" | cut -f1))"

# ─────────────────────────────────────────────
# 2. claudecodeui 빌드 (app/dist/)
# ─────────────────────────────────────────────
if [ "${SKIP_NPM_INSTALL:-0}" != "1" ]; then
  if [ ! -d "$APP_DIR/node_modules" ] || [ "$APP_DIR/package-lock.json" -nt "$APP_DIR/node_modules" ]; then
    info "app/ npm install ..."
    ( cd "$APP_DIR" && npm install )
  else
    ok "app/node_modules 캐시 재사용"
  fi
fi

info "app/ npm run build ..."
( cd "$APP_DIR" && npm run build )
if [ ! -d "$APP_DIR/dist" ]; then
  err "app/dist 가 생성되지 않았습니다"
  exit 1
fi
ok "claudecodeui 빌드 완료 ($(du -sh "$APP_DIR/dist" | cut -f1))"

# ─────────────────────────────────────────────
# 3. runtime tarball 생성
# ─────────────────────────────────────────────
info "runtime tarball 생성 (node_modules / *.db / *.env 제외)..."

# staging 안에 'claudecodeui' 라는 디렉토리로 복사 — install.sh 가 그대로
# ~/.vienna/claudecodeui 로 옮길 수 있도록 이름을 명시한다.
STAGING_RUNTIME="$STAGING_DIR/claudecodeui"
mkdir -p "$STAGING_RUNTIME"

rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='auth.db' \
  --exclude='auth.db-journal' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  --exclude='coverage' \
  --exclude='.vite' \
  --exclude='.cache' \
  --exclude='playwright-report' \
  --exclude='test-results' \
  --exclude='temp' \
  --exclude='tmp' \
  --exclude='logs' \
  "$APP_DIR/" "$STAGING_RUNTIME/"

# 메타: 빌드한 버전 / 빌드 시각을 함께 넣어두면 디버깅에 편하다
cat > "$STAGING_RUNTIME/.vienna-runtime.json" <<EOF
{
  "vienna_version": "${VERSION}",
  "built_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "host": "$(uname -n)",
  "node": "$(node --version)"
}
EOF

# Strip dev-only npm lifecycle hooks (husky, lint-staged, etc.) from
# the staging package.json so the runtime install can run with
# `npm install --omit=dev` without choking on missing dev binaries.
# The original package.json is preserved in the source tree.
info "staging package.json 에서 dev-only 라이프사이클 훅 제거..."
node -e "
  const fs = require('fs');
  const path = '$STAGING_RUNTIME/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.scripts = pkg.scripts || {};
  for (const key of ['prepare', 'precommit', 'commitmsg']) {
    if (pkg.scripts[key]) {
      delete pkg.scripts[key];
    }
  }
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"

tar -czf "$OUTPUT_DIR/$TARBALL_NAME" -C "$STAGING_DIR" claudecodeui
ok "runtime tarball: $OUTPUT_DIR/$TARBALL_NAME ($(du -h "$OUTPUT_DIR/$TARBALL_NAME" | cut -f1))"

# ─────────────────────────────────────────────
# 4. install.sh 도 staging 으로
# ─────────────────────────────────────────────
cp "$VIENNA_DIR/install.sh" "$OUTPUT_DIR/install.sh"
ok "install.sh 복사"

rm -rf "$STAGING_DIR"

echo ""
echo "${BOLD}${GREEN}✓ Release artifacts ready at: $OUTPUT_DIR${RESET}"
ls -lh "$OUTPUT_DIR" | tail -n +2 | awk '{printf "  %-40s %s\n", $9, $5}'
echo ""
echo "다음 단계:"
echo "  GitHub release 에 위 3 개 파일을 업로드하거나, scripts/publish.sh 를 사용하세요."
echo ""
