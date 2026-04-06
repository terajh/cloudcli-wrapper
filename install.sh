#!/usr/bin/env bash
#
# CloudCLI Desktop Installer
#
# Tauri 기반 claudecodeui 데스크톱 앱을 설치한다.
# 사용법: curl -fsSL https://raw.githubusercontent.com/terajh/cloudcli-wrapper/develop/tauri/install.sh | bash
#        또는 ./install.sh

set -euo pipefail

# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────
INSTALL_DIR="${CLOUDCLI_INSTALL_DIR:-$HOME/.cloudcli}"
CLOUDCLI_REPO="https://github.com/siteboon/claudecodeui.git"
WRAPPER_REPO="https://github.com/terajh/cloudcli-wrapper.git"
WRAPPER_BRANCH="develop/tauri"
APP_DEST="/Applications/CloudCLI.app"

# 색상
BOLD=$'\033[1m'
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
RESET=$'\033[0m'

info()  { echo "${BLUE}[INFO]${RESET} $*"; }
ok()    { echo "${GREEN}[OK]${RESET}   $*"; }
warn()  { echo "${YELLOW}[WARN]${RESET} $*"; }
err()   { echo "${RED}[ERR]${RESET}  $*" >&2; }

# ─────────────────────────────────────────────
# 플랫폼 체크
# ─────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  err "이 스크립트는 macOS 전용입니다."
  exit 1
fi

echo "${BOLD}CloudCLI Desktop Installer${RESET}"
echo "설치 경로: $INSTALL_DIR"
echo ""

# ─────────────────────────────────────────────
# 1. Xcode Command Line Tools
# ─────────────────────────────────────────────
if ! xcode-select -p >/dev/null 2>&1; then
  info "Xcode Command Line Tools 설치가 필요합니다."
  xcode-select --install || true
  echo "설치 완료 후 이 스크립트를 다시 실행해주세요."
  exit 1
fi
ok "Xcode Command Line Tools 확인"

# ─────────────────────────────────────────────
# 2. Node.js 체크 (nvm 셸 로딩 포함)
# ─────────────────────────────────────────────
load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
}
load_nvm

if ! command -v node >/dev/null 2>&1; then
  err "Node.js가 설치되어 있지 않습니다."
  echo "  설치: https://nodejs.org/ 또는 'brew install node'"
  exit 1
fi
NODE_VERSION=$(node --version)
ok "Node.js 확인: $NODE_VERSION"

# ─────────────────────────────────────────────
# 3. Rust / Cargo 체크 및 설치
# ─────────────────────────────────────────────
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
fi

if ! command -v cargo >/dev/null 2>&1; then
  info "Rust가 설치되어 있지 않습니다. 설치를 시작합니다..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
  ok "Rust 설치 완료: $(rustc --version)"
else
  ok "Rust 확인: $(rustc --version)"
fi

# ─────────────────────────────────────────────
# 4. Tauri CLI 설치
# ─────────────────────────────────────────────
if ! cargo tauri --version >/dev/null 2>&1; then
  info "Tauri CLI 설치 중... (몇 분 소요됩니다)"
  cargo install tauri-cli --version "^2"
  ok "Tauri CLI 설치 완료"
else
  ok "Tauri CLI 확인: $(cargo tauri --version)"
fi

# ─────────────────────────────────────────────
# 5. claudecodeui 클론 및 빌드
# ─────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"

CLOUDCLI_SRC="$INSTALL_DIR/claudecodeui"
if [ -d "$CLOUDCLI_SRC/.git" ]; then
  info "claudecodeui 업데이트 중..."
  git -C "$CLOUDCLI_SRC" pull --ff-only
else
  info "claudecodeui 클론 중..."
  git clone "$CLOUDCLI_REPO" "$CLOUDCLI_SRC"
fi
ok "claudecodeui 소스 준비 완료"

info "claudecodeui 의존성 설치 중... (시간이 걸릴 수 있습니다)"
(cd "$CLOUDCLI_SRC" && npm install)

info "claudecodeui 프론트엔드 빌드 중..."
(cd "$CLOUDCLI_SRC" && npm run build)
ok "claudecodeui 빌드 완료"

# ─────────────────────────────────────────────
# 6. cloudcli-wrapper 클론
# ─────────────────────────────────────────────
WRAPPER_SRC="$INSTALL_DIR/cloudcli-wrapper"
if [ -d "$WRAPPER_SRC/.git" ]; then
  info "cloudcli-wrapper 업데이트 중..."
  git -C "$WRAPPER_SRC" fetch origin
  git -C "$WRAPPER_SRC" checkout "$WRAPPER_BRANCH"
  git -C "$WRAPPER_SRC" pull --ff-only
else
  info "cloudcli-wrapper 클론 중..."
  git clone --branch "$WRAPPER_BRANCH" "$WRAPPER_REPO" "$WRAPPER_SRC"
fi
ok "cloudcli-wrapper 소스 준비 완료"

# ─────────────────────────────────────────────
# 7. Tauri 앱 빌드
# ─────────────────────────────────────────────
info "Tauri 앱 빌드 중... (처음엔 시간이 오래 걸립니다)"
export CLOUDCLI_DIR="$CLOUDCLI_SRC"
(cd "$WRAPPER_SRC" && cargo tauri build)
ok "Tauri 앱 빌드 완료"

BUILT_APP="$WRAPPER_SRC/src-tauri/target/release/bundle/macos/CloudCLI.app"
if [ ! -d "$BUILT_APP" ]; then
  err "빌드 결과물을 찾을 수 없습니다: $BUILT_APP"
  exit 1
fi

# ─────────────────────────────────────────────
# 8. /Applications 에 설치
# ─────────────────────────────────────────────
if [ -d "$APP_DEST" ]; then
  info "기존 앱 제거: $APP_DEST"
  rm -rf "$APP_DEST"
fi

info "앱 설치: $APP_DEST"
cp -R "$BUILT_APP" "$APP_DEST"

# macOS 쿼런틴 속성 제거 (GitHub에서 다운받은 바이너리 실행 차단 해제)
xattr -cr "$APP_DEST" 2>/dev/null || true

ok "설치 완료!"
echo ""
echo "${BOLD}${GREEN}✓ CloudCLI가 설치되었습니다.${RESET}"
echo ""
echo "  실행: ${BOLD}open $APP_DEST${RESET}"
echo "  또는 Launchpad에서 'CloudCLI' 검색"
echo ""
echo "  claudecodeui 소스: $CLOUDCLI_SRC"
echo "  wrapper 소스:     $WRAPPER_SRC"
echo ""
