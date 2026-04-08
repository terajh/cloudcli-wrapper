#!/usr/bin/env bash
#
# Vienna Desktop — double-click installer launcher
#
# 이 파일은 .command 확장자라서 Finder 에서 더블클릭하면 Terminal 이
# 자동으로 열고 그 안에서 실행된다. 본 스크립트의 유일한 역할은
# 최신 install.sh 를 내려받아 bash 에 파이프해 주는 것이다.
# 실제 설치 로직은 release 에 포함된 install.sh 에 있다.
#
# 사용법:
#   1. GitHub release 에서 Vienna-installer.command.zip 다운로드
#   2. zip 을 더블클릭해 이 파일(.command)을 풀고
#   3. 이 파일을 다시 더블클릭 (최초 1회 Gatekeeper 경고 나오면
#      시스템 설정 → 개인정보 보호 및 보안 → 맨 아래 "그래도 열기")
#
# 환경변수(선택):
#   VIENNA_VERSION   설치할 버전 태그 (기본: latest release)

set -e

# ── 헤더 ──────────────────────────────────────────────
cd "$(dirname "$0")" 2>/dev/null || true

BOLD=$'\033[1m'
BLUE=$'\033[34m'
GREEN=$'\033[32m'
RED=$'\033[31m'
RESET=$'\033[0m'

echo ""
echo "${BOLD}Vienna Desktop Installer${RESET}"
echo "────────────────────────────────"
echo ""

# ── macOS 체크 ────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  echo "${RED}이 installer 는 macOS 전용입니다.${RESET}"
  read -n 1 -s -r -p "아무 키나 눌러 창을 닫으세요..."
  exit 1
fi

# ── install.sh 다운로드 + 실행 ────────────────────────
VERSION="${VIENNA_VERSION:-v0.6.2}"
INSTALL_URL="https://github.com/terajh/vienna/releases/download/${VERSION}/install.sh"

echo "${BLUE}설치 스크립트 다운로드:${RESET} ${INSTALL_URL}"
echo ""

if ! curl -fsSL "$INSTALL_URL" | bash; then
  echo ""
  echo "${RED}설치가 실패했습니다.${RESET}"
  echo "수동 설치 방법:"
  echo "  curl -fsSL $INSTALL_URL | bash"
  echo ""
  read -n 1 -s -r -p "아무 키나 눌러 창을 닫으세요..."
  exit 1
fi

# ── 완료 ──────────────────────────────────────────────
echo ""
echo "${GREEN}${BOLD}✓ Vienna 설치가 완료되었습니다.${RESET}"
echo ""
echo "  실행: ${BOLD}open /Applications/Vienna.app${RESET}"
echo "  또는 Launchpad/Spotlight 에서 'Vienna' 검색"
echo ""
read -n 1 -s -r -p "아무 키나 눌러 창을 닫으세요..."
echo ""
