# Vienna 빌드 명령어 레퍼런스

## 레이어별 빌드

### React UI (app/src/)
```bash
cd /Users/carter.p/Dev/kakao/vienna/app
pnpm typecheck                    # tsc --noEmit
pnpm build                        # vite build → dist/
pnpm lint                         # eslint
```

### Express 서버 단독 실행
```bash
cd /Users/carter.p/Dev/kakao/vienna/app
SERVER_PORT=5888 DATABASE_PATH=~/.vienna/auth.db node server/index.js
```

### Tauri 개발 모드
```bash
cd /Users/carter.p/Dev/kakao/vienna
cargo tauri dev                   # app/dist + Rust 셸 함께 실행
```

### Tauri 프로덕션 빌드
```bash
cargo tauri build                 # DMG + .app 생성
```

## 재시작 명령어

### Vienna 전체 재시작
```bash
pkill -9 -x Vienna
pkill -9 -f "vienna/app/server"
sleep 2
open /Applications/Vienna.app
```

### 서버만 재시작
```bash
pkill -9 -f "vienna/app/server"
cd /Users/carter.p/Dev/kakao/vienna/app
SERVER_PORT=5888 DATABASE_PATH=~/.vienna/auth.db node server/index.js &
```

## Health Check
```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5888
tail -20 ~/Library/Logs/Vienna/server.log
```

## 심볼릭 링크 (개발 편의)
```bash
# 확인
ls -la ~/.vienna/claudecodeui

# 설정 (dev tree 연결)
rm -rf ~/.vienna/claudecodeui
ln -s /Users/carter.p/Dev/kakao/vienna/app ~/.vienna/claudecodeui
```

## Node 재빌드 (ABI mismatch 시)
```bash
cd /Users/carter.p/Dev/kakao/vienna/app
/Users/carter.p/.nvm/versions/node/v24.3.0/bin/npm rebuild better-sqlite3
```
