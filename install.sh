#!/usr/bin/env bash
#
# Vienna Desktop Installer (DMG-based)
#
# v0.5.0 DMG를 다운로드해서 /Applications 에 설치하고,
# Vienna 전용 claudecodeui fork(caui-customizations 브랜치)를 받아서
# 프론트엔드까지 빌드해 바로 실행 가능한 상태로 만든다.
#
# 사용법:
#   curl -fsSL https://github.com/terajh/vienna/releases/download/v0.5.0/install.sh | bash
#   또는
#   ./install.sh
#
# 환경변수:
#   VIENNA_VERSION         설치할 버전 태그       (기본: v0.5.0)
#   VIENNA_INSTALL_DIR     claudecodeui 설치 위치 (기본: ~/.vienna)
#   VIENNA_REINSTALL_DEPS  1이면 node_modules 재설치 강제

set -euo pipefail

# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────
VERSION="${VIENNA_VERSION:-v0.5.0}"
DMG_NAME="Vienna_${VERSION#v}_aarch64.dmg"
DMG_URL="https://github.com/terajh/vienna/releases/download/${VERSION}/${DMG_NAME}"
APP_DEST="/Applications/Vienna.app"
INSTALL_DIR="${VIENNA_INSTALL_DIR:-$HOME/.vienna}"
CLAUDECODEUI_DIR="$INSTALL_DIR/claudecodeui"
CLAUDECODEUI_REPO="https://github.com/terajh/claudecodeui.git"
CLAUDECODEUI_BRANCH="caui-customizations"

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
# 6. claudecodeui 셋업 (Vienna fork, caui-customizations 브랜치)
# ─────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"

REINSTALL_DEPS="${VIENNA_REINSTALL_DEPS:-0}"

if [ -d "$CLAUDECODEUI_DIR/.git" ]; then
  info "기존 claudecodeui 업데이트 중 (origin → ${CLAUDECODEUI_BRANCH})..."

  # Vienna fork 가 아닌 다른 remote 가 origin 에 박혀 있으면 교정
  CURRENT_ORIGIN="$(git -C "$CLAUDECODEUI_DIR" remote get-url origin 2>/dev/null || true)"
  if [ "$CURRENT_ORIGIN" != "$CLAUDECODEUI_REPO" ]; then
    warn "기존 origin 이 다릅니다 ($CURRENT_ORIGIN). Vienna fork 로 교체합니다."
    git -C "$CLAUDECODEUI_DIR" remote set-url origin "$CLAUDECODEUI_REPO"
  fi

  git -C "$CLAUDECODEUI_DIR" fetch origin "$CLAUDECODEUI_BRANCH"

  # 로컬 변경 / 잘못된 브랜치 위에 있으면 안전하게 reset (사용자 확인 후)
  if ! git -C "$CLAUDECODEUI_DIR" diff --quiet HEAD 2>/dev/null \
     || ! git -C "$CLAUDECODEUI_DIR" diff --cached --quiet HEAD 2>/dev/null; then
    warn "claudecodeui 작업 트리에 미커밋 변경이 있습니다. ${CLAUDECODEUI_BRANCH} 로 강제 동기화합니다."
  fi
  git -C "$CLAUDECODEUI_DIR" checkout -B "$CLAUDECODEUI_BRANCH" "origin/${CLAUDECODEUI_BRANCH}"
  git -C "$CLAUDECODEUI_DIR" reset --hard "origin/${CLAUDECODEUI_BRANCH}"
else
  info "claudecodeui Vienna fork 클론 중..."
  git clone -b "$CLAUDECODEUI_BRANCH" "$CLAUDECODEUI_REPO" "$CLAUDECODEUI_DIR"
  REINSTALL_DEPS=1  # fresh clone 이면 무조건 install
fi

ok "claudecodeui 소스 준비 완료: $CLAUDECODEUI_DIR ($(git -C "$CLAUDECODEUI_DIR" rev-parse --short HEAD) on $(git -C "$CLAUDECODEUI_DIR" rev-parse --abbrev-ref HEAD))"

# 의존성 설치 — node_modules 가 없거나, lockfile 이 갱신됐거나, 강제 재설치 모드면 실행
NEED_INSTALL=0
if [ "$REINSTALL_DEPS" = "1" ]; then
  NEED_INSTALL=1
elif [ ! -d "$CLAUDECODEUI_DIR/node_modules" ]; then
  NEED_INSTALL=1
elif [ "$CLAUDECODEUI_DIR/package-lock.json" -nt "$CLAUDECODEUI_DIR/node_modules" ]; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" = "1" ]; then
  info "claudecodeui 의존성 설치 중... (시간이 걸릴 수 있습니다)"
  (cd "$CLAUDECODEUI_DIR" && npm install)
else
  ok "claudecodeui 의존성 캐시 재사용"
fi

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
