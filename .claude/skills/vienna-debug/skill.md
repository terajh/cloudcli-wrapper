---
name: vienna-debug
description: "Vienna 디버깅 스킬. 서버 로그 분석, health check, 알려진 오류 패턴 진단. debug, 디버깅, 로그 분석, health check, 오류, error 키워드로 호출."
---

# Vienna Debug — 로그 분석 & 문제 진단

## 워크플로우

### Step 1: 기본 Health Check
```bash
# HTTP 응답
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5888

# 프로세스 확인
ps aux | grep -E "vienna|server/index" | grep -v grep

# 포트 확인
lsof -i :5888
```

### Step 2: 로그 분석
```bash
# 최근 50줄
tail -50 ~/Library/Logs/Vienna/server.log

# 에러만 필터
grep -i "error\|fail\|crash\|uncaught" ~/Library/Logs/Vienna/server.log | tail -30

# 실시간 모니터링
tail -f ~/Library/Logs/Vienna/server.log
```

### Step 3: 알려진 패턴 매핑

#### Claude SDK Nested Session
```
키워드: "nested session", 즉시 종료
원인: CLAUDECODE / CLAUDE_CODE_* / ANTHROPIC_* 환경변수 유입
확인: grep -n "env_remove" src-tauri/src/lib.rs
```

#### SQLite ABI Mismatch
```
키워드: "better-sqlite3", "ABI mismatch", "NODE_MODULE_VERSION"
원인: Node 버전 변경
해결: cd app && npm rebuild better-sqlite3
```

#### Provider CLI Not Found
```
키워드: "command not found", "ENOENT", PTY spawn 실패
원인: binary PATH 없음
확인: grep -n "command -v" app/server/index.js
```

#### WebSocket 연결 실패
```
키워드: "WebSocket", "ECONNREFUSED", 재연결 반복
확인: /ws 엔드포인트 로그, PTY 프로세스 상태
```

#### DMG 볼륨 충돌 (릴리즈 시)
```
키워드: "resource busy", "hdiutil"
해결: hdiutil detach /Volumes/Vienna -force
```

### Step 4: 상황별 해결 경로

```
HTTP 200 반환 → 기본 동작 OK
  └── UI 문제? → 브라우저 콘솔 확인 (DevTools)

HTTP 실패 / 연결 거부
  ├── 프로세스 없음? → vienna-dev-cycle로 재시작
  ├── 포트 충돌? → lsof -i :5888, PID kill
  └── 서버 crash? → 로그에서 원인 파악

로그에 에러 패턴 발견
  ├── Nested session → lib.rs env_remove 확인
  ├── ABI mismatch → npm rebuild better-sqlite3
  ├── Provider not found → PATH + pre-flight 확인
  └── 기타 → vienna-regression-guard 회귀 분석 요청
```

## 에이전트
`vienna-debug` 에이전트 사용 시 위 절차를 자동 수행
