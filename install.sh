#!/usr/bin/env bash
#
# Vienna Desktop Installer (DMG-based)
#
# v0.4.1 DMG를 다운로드해서 /Applications 에 설치하고,
# claudecodeui 프론트엔드까지 빌드해서 바로 실행 가능한 상태로 만든다.
#
# 사용법:
#   curl -fsSL https://github.com/terajh/vienna/releases/download/v0.4.1/install.sh | bash
#   또는
#   ./install.sh

set -euo pipefail

# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────
VERSION="${VIENNA_VERSION:-v0.4.1}"
DMG_NAME="Vienna_${VERSION#v}_aarch64.dmg"
DMG_URL="https://github.com/terajh/vienna/releases/download/${VERSION}/${DMG_NAME}"
APP_DEST="/Applications/Vienna.app"
INSTALL_DIR="${VIENNA_INSTALL_DIR:-$HOME/.vienna}"
CLAUDECODEUI_DIR="$INSTALL_DIR/claudecodeui"
CLAUDECODEUI_REPO="https://github.com/siteboon/claudecodeui.git"

# 색상
BOLD=$'\033[1m'
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
RESET=$'\033[0m'

info() { echo "${BLUE}[INFO]${RESET} $*"; }
ok()   { echo "${GREEN}[ OK ]${RESET} $*"; }
warn() { echo "${YELLOW}[WARN]${RESET} $*"; }
err()  { echo "${RED}[ERR ]${RESET} $*" >&2; }

# ─────────────────────────────────────────────
# 플랫폼 체크
# ─────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  err "이 스크립트는 macOS 전용입니다."
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  warn "현재 DMG는 Apple Silicon(arm64) 전용입니다. Intel Mac에서는 동작하지 않을 수 있습니다."
fi

echo ""
echo "${BOLD}Vienna Desktop Installer (${VERSION})${RESET}"
echo ""

# ─────────────────────────────────────────────
# 1. 기존 프로세스 종료
# ─────────────────────────────────────────────
if pgrep -x "Vienna" >/dev/null 2>&1; then
  info "실행 중인 Vienna 프로세스 종료..."
  pkill -x "Vienna" 2>/dev/null || true
  sleep 1
fi

# ─────────────────────────────────────────────
# 2. DMG 다운로드
# ─────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"; hdiutil detach "/Volumes/Vienna" -quiet 2>/dev/null || true' EXIT

DMG_PATH="$TMP_DIR/$DMG_NAME"
info "DMG 다운로드: $DMG_URL"
if ! curl -fL --progress-bar -o "$DMG_PATH" "$DMG_URL"; then
  err "DMG 다운로드 실패"
  exit 1
fi
ok "DMG 다운로드 완료 ($(du -h "$DMG_PATH" | cut -f1))"

# ─────────────────────────────────────────────
# 3. DMG 마운트 + 앱 복사
# ─────────────────────────────────────────────
info "DMG 마운트..."
hdiutil detach "/Volumes/Vienna" -quiet 2>/dev/null || true
MOUNT_OUTPUT="$(hdiutil attach "$DMG_PATH" -nobrowse -quiet)"
MOUNT_POINT="$(echo "$MOUNT_OUTPUT" | tail -n1 | awk '{for (i=3; i<=NF; i++) printf "%s ", $i; print ""}' | sed 's/ *$//')"

if [ -z "$MOUNT_POINT" ] || [ ! -d "$MOUNT_POINT" ]; then
  # fallback
  MOUNT_POINT="/Volumes/Vienna"
fi

if [ ! -d "$MOUNT_POINT/Vienna.app" ]; then
  err "마운트된 DMG에서 Vienna.app을 찾을 수 없습니다: $MOUNT_POINT"
  exit 1
fi

if [ -d "$APP_DEST" ]; then
  info "기존 앱 제거: $APP_DEST"
  rm -rf "$APP_DEST"
fi

info "앱 복사: $APP_DEST"
cp -R "$MOUNT_POINT/Vienna.app" "$APP_DEST"

info "DMG 언마운트..."
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

# ─────────────────────────────────────────────
# 4. 쿼런틴 속성 제거 (중요!)
# ─────────────────────────────────────────────
info "쿼런틴 속성 제거 (xattr -cr)..."
xattr -cr "$APP_DEST" 2>/dev/null || true
ok "앱 설치 완료: $APP_DEST"

# ─────────────────────────────────────────────
# 5. Node.js 체크
# ─────────────────────────────────────────────
load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
}
load_nvm

if ! command -v node >/dev/null 2>&1; then
  err "Node.js가 설치되어 있지 않습니다."
  echo "  설치: https://nodejs.org/ 또는 'brew install node'"
  echo "  설치 후 아래 명령으로 claudecodeui 셋업을 이어서 진행하세요:"
  echo "    mkdir -p $INSTALL_DIR"
  echo "    git clone $CLAUDECODEUI_REPO $CLAUDECODEUI_DIR"
  echo "    cd $CLAUDECODEUI_DIR && npm install && npm run build"
  exit 1
fi
ok "Node.js 확인: $(node --version)"

# ─────────────────────────────────────────────
# 6. claudecodeui 셋업
# ─────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"

if [ -d "$CLAUDECODEUI_DIR/.git" ]; then
  info "claudecodeui 업데이트 중..."
  git -C "$CLAUDECODEUI_DIR" fetch origin
  git -C "$CLAUDECODEUI_DIR" pull --ff-only || warn "pull 실패 — 로컬 변경사항이 있을 수 있습니다"
else
  info "claudecodeui 클론 중..."
  git clone "$CLAUDECODEUI_REPO" "$CLAUDECODEUI_DIR"
fi
ok "claudecodeui 소스 준비 완료: $CLAUDECODEUI_DIR"

info "claudecodeui 의존성 설치 중... (시간이 걸릴 수 있습니다)"
(cd "$CLAUDECODEUI_DIR" && npm install)

info "claudecodeui 프론트엔드 빌드 중..."
(cd "$CLAUDECODEUI_DIR" && npm run build)
ok "claudecodeui 빌드 완료"

# ─────────────────────────────────────────────
# 완료
# ─────────────────────────────────────────────
echo ""
echo "${BOLD}${GREEN}✓ Vienna ${VERSION} 설치 완료!${RESET}"
echo ""
echo "  실행: ${BOLD}open $APP_DEST${RESET}"
echo "  또는 Launchpad/Spotlight에서 'Vienna' 검색"
echo ""
echo "  claudecodeui 소스: $CLAUDECODEUI_DIR"
echo "  앱 위치:          $APP_DEST"
echo ""
