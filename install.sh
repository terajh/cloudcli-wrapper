#!/usr/bin/env bash
#
# Vienna Desktop Installer
#
# Vienna v0.6.0 부터는 단일 repo 방식으로 배포된다.
# 이 스크립트는 다음을 한 번에 처리한다:
#   1. Vienna_X.Y.Z_aarch64.dmg 다운로드 → /Applications/Vienna.app
#   2. claudecodeui-runtime-X.Y.Z.tar.gz 다운로드 → ~/.vienna/claudecodeui
#      (사전 빌드된 dist 가 들어 있어 별도 빌드 단계 없음)
#   3. npm install --omit=dev 로 production 의존성만 설치
#
# 사용법:
#   curl -fsSL https://github.com/terajh/vienna/releases/download/v0.6.2/install.sh | bash
#   또는
#   ./install.sh
#
# 환경변수:
#   VIENNA_VERSION         설치할 버전 태그       (기본: v0.6.2)
#   VIENNA_INSTALL_DIR     runtime 설치 위치      (기본: ~/.vienna)
#   VIENNA_REINSTALL_DEPS  1 이면 node_modules 재설치 강제

set -euo pipefail

# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────
VERSION="${VIENNA_VERSION:-v0.6.2}"
DMG_NAME="Vienna_${VERSION#v}_aarch64.dmg"
TARBALL_NAME="vienna-runtime-${VERSION#v}.tar.gz"
RELEASE_BASE="https://github.com/terajh/vienna/releases/download/${VERSION}"
DMG_URL="${RELEASE_BASE}/${DMG_NAME}"
TARBALL_URL="${RELEASE_BASE}/${TARBALL_NAME}"

APP_DEST="/Applications/Vienna.app"
INSTALL_DIR="${VIENNA_INSTALL_DIR:-$HOME/.vienna}"
RUNTIME_DIR="$INSTALL_DIR/claudecodeui"
RUNTIME_BACKUP_DIR="$INSTALL_DIR/claudecodeui.backup-$(date +%Y%m%d-%H%M%S)"

# 색상
BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
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
  warn "현재 DMG 는 Apple Silicon(arm64) 전용입니다. Intel Mac 에서는 동작하지 않을 수 있습니다."
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
# 2. 다운로드
# ─────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"; hdiutil detach "/Volumes/Vienna" -quiet 2>/dev/null || true' EXIT

DMG_PATH="$TMP_DIR/$DMG_NAME"
TARBALL_PATH="$TMP_DIR/$TARBALL_NAME"

info "DMG 다운로드: $DMG_URL"
if ! curl -fL --progress-bar -o "$DMG_PATH" "$DMG_URL"; then
  err "DMG 다운로드 실패"
  exit 1
fi
ok "DMG 다운로드 완료 ($(du -h "$DMG_PATH" | cut -f1))"

info "claudecodeui runtime tarball 다운로드: $TARBALL_URL"
if ! curl -fL --progress-bar -o "$TARBALL_PATH" "$TARBALL_URL"; then
  err "tarball 다운로드 실패"
  exit 1
fi
ok "tarball 다운로드 완료 ($(du -h "$TARBALL_PATH" | cut -f1))"

# ─────────────────────────────────────────────
# 3. DMG 마운트 + 앱 설치
# ─────────────────────────────────────────────
info "DMG 마운트..."
hdiutil detach "/Volumes/Vienna" -quiet 2>/dev/null || true
MOUNT_OUTPUT="$(hdiutil attach "$DMG_PATH" -nobrowse -quiet)"
MOUNT_POINT="$(echo "$MOUNT_OUTPUT" | tail -n1 | awk '{for (i=3; i<=NF; i++) printf "%s ", $i; print ""}' | sed 's/ *$//')"
if [ -z "$MOUNT_POINT" ] || [ ! -d "$MOUNT_POINT" ]; then
  MOUNT_POINT="/Volumes/Vienna"
fi
if [ ! -d "$MOUNT_POINT/Vienna.app" ]; then
  err "마운트된 DMG 에서 Vienna.app 을 찾을 수 없습니다: $MOUNT_POINT"
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

info "쿼런틴 속성 제거 (xattr -cr)..."
xattr -cr "$APP_DEST" 2>/dev/null || true
ok "앱 설치 완료: $APP_DEST"

# ─────────────────────────────────────────────
# 4. Node.js 체크
# ─────────────────────────────────────────────
load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
}
load_nvm

if ! command -v node >/dev/null 2>&1; then
  err "Node.js 가 설치되어 있지 않습니다."
  echo "  설치: https://nodejs.org/ 또는 'brew install node'"
  echo "  설치 후 이 스크립트를 다시 실행하면 runtime 설치를 이어서 진행합니다."
  exit 1
fi
ok "Node.js 확인: $(node --version)"

if ! command -v npm >/dev/null 2>&1; then
  err "npm 이 PATH 에 없습니다."
  exit 1
fi

# ─────────────────────────────────────────────
# 5. claudecodeui runtime 셋업
# ─────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"

if [ -L "$RUNTIME_DIR" ]; then
  # 개발자 모드: 심볼릭 링크면 dev 체크아웃을 보호하기 위해 runtime
  # 교체를 건너뛴다. 기존 dev 설치를 그대로 사용한다.
  REAL_TARGET="$(readlink "$RUNTIME_DIR")"
  warn "claudecodeui 가 심볼릭 링크입니다 → $REAL_TARGET"
  warn "개발자 환경으로 보입니다. runtime tarball 적용을 건너뜁니다."
  warn "(VIENNA_INSTALL_DIR 환경변수로 다른 경로에 설치할 수 있습니다.)"
else
  # 기존 설치가 있으면 backup
  if [ -d "$RUNTIME_DIR" ]; then
    info "기존 runtime backup: $RUNTIME_BACKUP_DIR"
    mv "$RUNTIME_DIR" "$RUNTIME_BACKUP_DIR"
  fi

  info "tarball 압축 해제 → $RUNTIME_DIR"
  tar -xzf "$TARBALL_PATH" -C "$INSTALL_DIR"
  if [ ! -d "$RUNTIME_DIR" ]; then
    err "압축 해제 후 $RUNTIME_DIR 가 생성되지 않았습니다"
    exit 1
  fi

  # backup 에서 사용자 데이터 복원 (auth.db 등)
  if [ -d "$RUNTIME_BACKUP_DIR" ]; then
    if [ -f "$RUNTIME_BACKUP_DIR/auth.db" ]; then
      info "auth.db 복원 (이전 사용자 세션)"
      cp "$RUNTIME_BACKUP_DIR/auth.db" "$RUNTIME_DIR/auth.db"
    fi
    # node_modules 도 재사용 가능하면 옮긴다 (lockfile 같으면)
    if [ -d "$RUNTIME_BACKUP_DIR/node_modules" ] \
       && [ -f "$RUNTIME_BACKUP_DIR/package-lock.json" ] \
       && [ -f "$RUNTIME_DIR/package-lock.json" ] \
       && cmp -s "$RUNTIME_BACKUP_DIR/package-lock.json" "$RUNTIME_DIR/package-lock.json"; then
      info "node_modules 재사용 (lockfile 동일)"
      mv "$RUNTIME_BACKUP_DIR/node_modules" "$RUNTIME_DIR/node_modules"
    fi
  fi

  ok "runtime 압축 해제 완료"
fi

# ─────────────────────────────────────────────
# 6. production 의존성 설치 (필요할 때만)
# ─────────────────────────────────────────────
NEED_INSTALL=0
if [ "${VIENNA_REINSTALL_DEPS:-0}" = "1" ]; then
  NEED_INSTALL=1
elif [ ! -L "$RUNTIME_DIR" ] && [ ! -d "$RUNTIME_DIR/node_modules" ]; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" = "1" ] && [ ! -L "$RUNTIME_DIR" ]; then
  info "production 의존성 설치 중... (시간이 걸릴 수 있습니다)"

  # `--ignore-scripts` so a stray dev-only `prepare` hook (husky etc.)
  # cannot break the install. We then run the project's required
  # `postinstall` (node-pty permission fix) explicitly. release.sh also
  # strips `prepare` from the staging package.json, but enforcing it on
  # the install side too keeps us robust against older tarballs and
  # CDN-cached release assets.
  ( cd "$RUNTIME_DIR" && npm install --omit=dev --ignore-scripts )

  if [ -f "$RUNTIME_DIR/scripts/fix-node-pty.js" ]; then
    info "postinstall 실행 (node-pty 권한 fix)..."
    ( cd "$RUNTIME_DIR" && node scripts/fix-node-pty.js ) || warn "fix-node-pty.js 실행 실패 (PTY 사용 시 권한 문제 발생 가능)"
  fi

  ok "의존성 설치 완료"
elif [ ! -L "$RUNTIME_DIR" ]; then
  ok "node_modules 캐시 재사용 (재설치하려면 VIENNA_REINSTALL_DEPS=1)"
fi

# ─────────────────────────────────────────────
# 완료
# ─────────────────────────────────────────────
echo ""
echo "${BOLD}${GREEN}✓ Vienna ${VERSION} 설치 완료!${RESET}"
echo ""
echo "  실행: ${BOLD}open $APP_DEST${RESET}"
echo "  또는 Launchpad/Spotlight 에서 'Vienna' 검색"
echo ""
echo "  runtime: $RUNTIME_DIR"
echo "  앱:     $APP_DEST"
if [ -d "$RUNTIME_BACKUP_DIR" ]; then
  echo "  backup: $RUNTIME_BACKUP_DIR  (문제가 없으면 직접 삭제하셔도 됩니다)"
fi
echo ""
