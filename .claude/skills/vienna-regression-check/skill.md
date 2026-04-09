---
name: vienna-regression-check
description: "Vienna 위험 영역 회귀 체크 스킬. 변경된 파일을 7개 위험 영역에 매핑하고 회귀 위험도를 평가. regression, 회귀, 위험 영역, danger zone, 코드 변경 검증 키워드로 호출."
---

# Vienna Regression Check — 위험 영역 회귀 검증

## 워크플로우

### Step 1: 변경 파일 목록 수집
```bash
git diff --name-only HEAD~1 HEAD    # 최근 커밋 기준
# 또는
git diff --name-only                # 현재 unstaged 변경
```

### Step 2: 위험 영역 매핑

변경 파일과 아래 매핑 테이블을 대조:

| 변경 파일 패턴 | 해당 위험 영역 |
|---------------|----------------|
| `useChatSessionState.ts` | #1 Temp→Real race, #3 Streaming tail |
| `useProjectsState.ts` | #2 세션 삭제 깜빡임 |
| `AppContent.tsx` | #5 Window drag |
| `src-tauri/src/lib.rs` | #4 Native 메뉴, #6 Nested session |
| `src-tauri/capabilities/` | #5 Window drag |
| `app/server/index.js` | #7 Provider CLI pre-flight |
| `useSessionStore.ts` | #1 Temp→Real race |

### Step 3: 영역별 빠른 grep 검증

```bash
# 영역 #1: 4중 가드 + peekSlot 패턴
grep -n "getSlot\|peekSlot\|pendingViewSession" \
  app/src/components/chat/hooks/useChatSessionState.ts

# 영역 #2: 삭제 방지 로직
grep -n "recentlyDeleted\|projects_updated" \
  app/src/hooks/useProjectsState.ts

# 영역 #3: tail isolation
grep -n "stableChatMessages\|tailChatMessage" \
  app/src/components/chat/hooks/useChatSessionState.ts

# 영역 #4: 줌 메뉴 단축키
grep -n "view_submenu\|apply_zoom\|on_menu_event" \
  src-tauri/src/lib.rs

# 영역 #5: drag region (둘 다 있어야 함)
grep -n "tauri-drag-region" app/src/components/app/AppContent.tsx
grep -n "allow-start-dragging" src-tauri/capabilities/default.json

# 영역 #6: env_remove 목록
grep -n "env_remove\|CLAUDECODE\|ANTHROPIC_" src-tauri/src/lib.rs

# 영역 #7: pre-flight + spawnSync 패턴
grep -n "command -v\|spawnSync" app/server/index.js
```

### Step 4: 위험도 판정

각 영역에 대해:
- **GREEN**: 변경 파일이 해당 영역과 무관
- **YELLOW**: 인접 파일 변경, 간접 영향 가능
- **RED**: 해당 파일 직접 수정, 핵심 패턴 확인 필요

### Step 5: 리포트 출력

```markdown
## Vienna 회귀 분석 리포트

### 변경 파일
- `파일명` — 영역 #N 관련 / 무관

### 위험도 매트릭스
| 위험 영역 | 위험도 | 확인 사항 |
|-----------|--------|-----------|
| #1 Temp→Real race | 🟢/🟡/🔴 | ... |
| #2 세션 삭제 깜빡임 | 🟢/🟡/🔴 | ... |
| #3 Streaming tail | 🟢/🟡/🔴 | ... |
| #4 Native 메뉴 | 🟢/🟡/🔴 | ... |
| #5 Window drag | 🟢/🟡/🔴 | ... |
| #6 Nested session | 🟢/🟡/🔴 | ... |
| #7 Provider CLI | 🟢/🟡/🔴 | ... |

### 필수 확인 사항
1. [ ] ...

### 결론
✅ SAFE / ⚠️ REVIEW NEEDED / 🚫 BLOCK
```

## 참고
- 위험 영역 상세: `references/danger-zones.md`
- 에이전트: `vienna-regression-guard`
