# Vienna GitHub Release 레퍼런스

## PAT 조회
```bash
PAT=$(security find-internet-password -s github.com -a terajh -w)
```

## Release 생성
```bash
PAT=$(security find-internet-password -s github.com -a terajh -w)
VERSION="v0.6.x"  # tauri.conf.json version 참조

curl -sS -X POST -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/terajh/vienna/releases \
  -d "{
    \"tag_name\":\"$VERSION\",
    \"target_commitish\":\"develop/tauri\",
    \"name\":\"Vienna $VERSION\",
    \"body\":\"릴리즈 노트\",
    \"draft\":false,
    \"prerelease\":false
  }"
# 응답에서 id 값을 RID로 저장
```

## Asset 업로드
```bash
PAT=$(security find-internet-password -s github.com -a terajh -w)
RID=<release_id>
OUT=release-output
VER="0.6.x"  # v 없는 버전

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
  echo ""
done
```

## Asset 교체 (동일 파일명 재업로드)
```bash
PAT=$(security find-internet-password -s github.com -a terajh -w)
RID=<release_id>
FILENAME="<filename>"

# 기존 asset id 조회
ASSET_ID=$(curl -sS -H "Authorization: token $PAT" \
  "https://api.github.com/repos/terajh/vienna/releases/$RID/assets" \
  | python3 -c "import sys,json; print([a['id'] for a in json.load(sys.stdin) if a['name']=='$FILENAME'][0])")

# 삭제
curl -sS -X DELETE -H "Authorization: token $PAT" \
  "https://api.github.com/repos/terajh/vienna/releases/assets/$ASSET_ID"

# 재업로드 (위 업로드 명령 반복)
```

## Release 목록 확인
```bash
PAT=$(security find-internet-password -s github.com -a terajh -w)
curl -sS -H "Authorization: token $PAT" \
  https://api.github.com/repos/terajh/vienna/releases | python3 -c "
import sys, json
for r in json.load(sys.stdin):
    print(f\"{r['id']}: {r['tag_name']} — {r['name']}\")
"
```

## 릴리즈 전 체크
```bash
# 버전 확인
cat src-tauri/tauri.conf.json | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])"
cat src-tauri/Cargo.toml | grep "^version"

# DMG 볼륨 충돌 방지
hdiutil detach /Volumes/Vienna -force 2>/dev/null || true

# release-output 확인
ls -lh release-output/
```
