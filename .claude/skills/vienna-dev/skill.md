---
name: vienna-dev
description: "Vienna 개발 빌드 및 재시작 사이클 스킬. React UI, Express 서버, Rust/Tauri 레이어별 빌드 경로 선택 및 실행. 빌드, 개발 서버, dev cycle, typecheck, restart, 재시작 키워드로 호출."
---

# Vienna Dev — 개발 빌드 & 재시작 사이클

## 워크플로우

### Step 1: 변경 레이어 파악
변경된 파일의 위치를 확인:
- `app/src/` → **React UI 레이어**
- `app/server/` → **Express 서버 레이어**
- `src-tauri/` → **Rust/Tauri 레이어**

### Step 2: 레이어별 최적 경로 실행

#### React UI만 변경된 경우
```bash
cd app
pnpm typecheck    # 타입 에러 먼저 확인 (실패 시 중단)
pnpm build        # dist/ 갱신
# symlink 환경이면 Cmd+R 만으로 반영
# 아니면 Vienna 전체 재시작
```

#### Express 서버만 변경된 경우
```bash
pkill -9 -f "vienna/app/server"
cd app && SERVER_PORT=5888 DATABASE_PATH=~/.vienna/auth.db node server/index.js &
sleep 2
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5888
```

#### Rust/Tauri 변경된 경우
```bash
cd app && pnpm build    # dist 먼저 갱신
cd ..
cargo tauri dev         # Rust + 웹뷰 함께 실행
```

#### 복합 변경 (여러 레이어)
```bash
cd app && pnpm typecheck && pnpm build && cd ..
pkill -9 -x Vienna; pkill -9 -f "vienna/app/server"
sleep 2
open /Applications/Vienna.app
```

### Step 3: 검증
```bash
# HTTP 응답 확인
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5888

# 로그 확인
tail -20 ~/Library/Logs/Vienna/server.log
```

## 심볼릭 링크 확인 (개발 편의)
```bash
ls -la ~/.vienna/claudecodeui
# /Users/carter.p/Dev/kakao/vienna/app 를 가리켜야 Cmd+R 반영 가능
```

끊어진 경우:
```bash
ln -s /Users/carter.p/Dev/kakao/vienna/app ~/.vienna/claudecodeui
```

## 참고
- 상세 명령어: `references/build-commands.md`
- 에이전트: `vienna-dev-cycle`
