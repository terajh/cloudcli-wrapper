---
name: vienna-release
description: "Vienna 릴리즈 빌드 및 GitHub 업로드 스킬. 버전 확인, scripts/release.sh 실행, asset 업로드까지 전 과정 안내. release, 릴리즈, 배포, DMG, github upload 키워드로 호출."
---

# Vienna Release — 릴리즈 빌드 & GitHub 업로드

## 사전 체크리스트

```bash
# 1. 버전 확인 (tauri.conf.json ↔ Cargo.toml 동기화)
cat src-tauri/tauri.conf.json | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])"
grep "^version" src-tauri/Cargo.toml

# 2. 브랜치 확인
git branch --show-current  # develop/tauri 이어야 함

# 3. DMG 볼륨 충돌 방지
hdiutil detach /Volumes/Vienna -force 2>/dev/null || true

# 4. release-output 정리 (선택)
# rm -rf release-output && mkdir release-output
```

## 빌드 실행

### 전체 빌드 (기본)
```bash
bash scripts/release.sh
```

### 부분 빌드 (시간 단축)
```bash
# Rust 재컴파일 생략 (tarball + bundle 재생성)
SKIP_TAURI=1 bash scripts/release.sh

# node_modules 재사용
SKIP_NPM_INSTALL=1 bash scripts/release.sh

# 둘 다 (가장 빠름, dist만 갱신된 경우)
SKIP_TAURI=1 SKIP_NPM_INSTALL=1 bash scripts/release.sh
```

### 빌드 결과 확인
```bash
ls -lh release-output/
# 예상 파일:
# Vienna_X.Y.Z_aarch64.dmg     ~3.4MB
# vienna-runtime-X.Y.Z.tar.gz  ~5.5MB
# install.sh                   ~10KB
# Vienna-installer-X.Y.Z.zip   ~136MB
```

## GitHub Release 생성 및 업로드

### Step 1: PAT 조회
```bash
PAT=$(security find-internet-password -s github.com -a terajh -w)
```

### Step 2: Release 생성 → RID 추출
```bash
VERSION="vX.Y.Z"  # tauri.conf.json version 앞에 v 붙이기
RESPONSE=$(curl -sS -X POST -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/terajh/vienna/releases \
  -d "{\"tag_name\":\"$VERSION\",\"target_commitish\":\"develop/tauri\",\"name\":\"Vienna $VERSION\",\"body\":\"릴리즈 노트\",\"draft\":false,\"prerelease\":false}")
RID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Release ID: $RID"
```

### Step 3: Asset 업로드
```bash
VER="X.Y.Z"  # v 없는 버전
OUT=release-output

for f in "Vienna_${VER}_aarch64.dmg" "vienna-runtime-${VER}.tar.gz" "install.sh" "Vienna-installer-${VER}.zip"; do
  case "$f" in
    *.dmg)    CT="application/x-apple-diskimage";;
    *.tar.gz) CT="application/gzip";;
    *.sh)     CT="text/x-shellscript";;
    *.zip)    CT="application/zip";;
  esac
  echo "Uploading $f..."
  curl -sS -X POST -H "Authorization: token $PAT" -H "Content-Type: $CT" \
    --data-binary "@$OUT/$f" \
    "https://uploads.github.com/repos/terajh/vienna/releases/$RID/assets?name=$f"
  echo "✓ $f"
done
```

## 참고
- GitHub API 상세: `references/github-release.md`
- 에이전트: `vienna-release`
