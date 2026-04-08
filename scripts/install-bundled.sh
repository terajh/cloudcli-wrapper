#!/bin/bash
#
# Vienna Desktop Installer (bundled)
# 자기 옆에 있는 Vienna.app + claudecodeui 디렉토리를 그대로 이식한다.
# 인터넷 다운로드 0회 — 모든 게 zip 안에 들어 있음.
#
# 이 파일은 release.sh 가 Vienna-installer-X.Y.Z.zip 을 패키징할 때
# 함께 동봉되며, 사용자는 zip 을 풀고 install.sh 를 더블클릭하면 된다.
# (curl 기반의 원격 install.sh 는 release-output/install.sh 에 따로
# 존재하니 혼동 주의.)
#
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SOURCE="$SCRIPT_DIR/Vienna.app"
RUNTIME_SOURCE="$SCRIPT_DIR/claudecodeui"
APP_DEST="/Applications/Vienna.app"
INSTALL_DIR="${VIENNA_INSTALL_DIR:-$HOME/.vienna}"
RUNTIME_DEST="$INSTALL_DIR/claudecodeui"

BOLD=$'\033[1m'; BLUE=$'\033[34m'; GREEN=$'\033[32m'; RED=$'\033[31m'; RESET=$'\033[0m'
info() { echo "${BLUE}[INFO]${RESET} $*"; }
ok()   { echo "${GREEN}[ OK ]${RESET} $*"; }
err()  { echo "${RED}[ERR ]${RESET} $*" >&2; }

echo
echo "${BOLD}Vienna Desktop Installer${RESET}"
echo "────────────────────────────"
echo

[[ "$(uname)" != "Darwin" ]] && { err "macOS 전용입니다."; read -n 1 -s -r -p "닫으려면 아무 키..."; exit 1; }
[ -d "$APP_SOURCE" ]      || { err "Vienna.app 을 찾을 수 없습니다: $APP_SOURCE"; read -n 1 -s -r -p "닫으려면 아무 키..."; exit 1; }
[ -d "$RUNTIME_SOURCE" ]  || { err "claudecodeui 를 찾을 수 없습니다: $RUNTIME_SOURCE"; read -n 1 -s -r -p "닫으려면 아무 키..."; exit 1; }

# 1. 실행 중 종료
if pgrep -x "vienna" >/dev/null 2>&1 || pgrep -x "Vienna" >/dev/null 2>&1; then
  info "실행 중인 Vienna 종료..."
  pkill -x "vienna" 2>/dev/null || true; pkill -x "Vienna" 2>/dev/null || true
  sleep 1
  pkill -9 -f "vienna/app/server" 2>/dev/null || true
fi

# 2. /Applications 에 .app 설치
info "Vienna.app → $APP_DEST"
xattr -cr "$APP_SOURCE" 2>/dev/null || true
rm -rf "$APP_DEST"
cp -R "$APP_SOURCE" "$APP_DEST"
xattr -cr "$APP_DEST" 2>/dev/null || true
ok "앱 설치 완료"

# 3. claudecodeui 런타임 배치
mkdir -p "$INSTALL_DIR"
if [ -L "$RUNTIME_DEST" ]; then
  info "claudecodeui 가 심볼릭 링크입니다 → $(readlink "$RUNTIME_DEST")"
  info "개발자 환경으로 보입니다. 런타임 교체를 건너뜁니다."
else
  if [ -d "$RUNTIME_DEST" ]; then
    BACKUP_DIR="$INSTALL_DIR/claudecodeui.backup-$(date +%Y%m%d-%H%M%S)"
    info "기존 런타임 backup → $BACKUP_DIR"
    mv "$RUNTIME_DEST" "$BACKUP_DIR"
  fi
  info "런타임 복사 → $RUNTIME_DEST"
  cp -R "$RUNTIME_SOURCE" "$RUNTIME_DEST"
  if [ -n "${BACKUP_DIR:-}" ] && [ -f "$BACKUP_DIR/auth.db" ]; then
    info "auth.db 복원 (이전 사용자 세션)"
    cp "$BACKUP_DIR/auth.db" "$RUNTIME_DEST/auth.db"
  fi
  ok "런타임 설치 완료"
fi

# 4. 실행
info "Vienna 실행..."
open "$APP_DEST"
sleep 1

# 5. 설치 폴더 자체 정리 (Choonnobi 패턴)
if [[ "$SCRIPT_DIR" == *"Vienna-installer"* ]]; then
  ( sleep 2; rm -rf "$SCRIPT_DIR" ) &
fi

echo
echo "${GREEN}${BOLD}✓ Vienna 설치 완료!${RESET}"
echo "  앱:     $APP_DEST"
echo "  런타임: $RUNTIME_DEST"
echo
