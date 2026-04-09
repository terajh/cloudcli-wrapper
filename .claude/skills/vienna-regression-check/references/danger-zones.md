# Vienna 위험 영역 상세 레퍼런스

## 영역 #1: Temp→Real 세션 ID 전환 race

**파일**: `app/src/components/chat/hooks/useChatSessionState.ts`  
**핵심 라인**: `:327` 부근 4중 가드

**검사 패턴**:
```typescript
// 반드시 있어야 하는 4중 가드
// 1. phase 가드
// 2. id+store 가드
// 3. pendingViewSessionRef 5s window
// 4. store has streaming

// 금지 패턴 (side-effect)
getSlot(...)   // ❌ 금지
peekSlot(...)  // ✅ 허용
```

**회귀 트리거**: `useChatSessionState.ts` 수정, 세션 관련 store 변경

---

## 영역 #2: 세션 삭제 깜빡임

**파일**: `app/src/hooks/useProjectsState.ts`

**검사 패턴**:
```typescript
// 반드시 있어야 하는 것들
recentlyDeletedSessionsRef  // 8s window
// projects_updated handler에서 strip 로직
```

**회귀 트리거**: `useProjectsState.ts` 수정, `projects_updated` WebSocket 이벤트 핸들러 변경

---

## 영역 #3: 스트리밍 Tail Isolation

**파일**: `app/src/components/chat/hooks/useChatSessionState.ts`

**검사 패턴**:
```typescript
stableChatMessages  // streaming 중 변경 없음 (referential 안정)
tailChatMessage     // streaming tail만 별도 관리
// visible list = stableChatMessages + tailChatMessage
```

**회귀 트리거**: 채팅 메시지 렌더링 로직 변경, streaming 이벤트 핸들러 수정

---

## 영역 #4: Native 메뉴 단축키

**파일**: `src-tauri/src/lib.rs`

**검사 패턴**:
```rust
// view_submenu 존재 확인
// on_menu_event에서 zoom 이벤트 처리
// window.__vienna_apply_zoom__ webview eval
```

**회귀 트리거**: `lib.rs` 메뉴 구조 변경, AppContent.tsx zoom 함수 변경

---

## 영역 #5: Window Drag

**파일**: 
- `app/src/components/app/AppContent.tsx`
- `src-tauri/capabilities/default.json`

**검사 패턴**:
```tsx
// AppContent.tsx에 반드시 있어야 함
data-tauri-drag-region  // 상단 28px strip
```
```json
// capabilities/default.json에 반드시 있어야 함
"core:window:allow-start-dragging"
```

**회귀 트리거**: AppContent.tsx 상단 레이아웃 변경, capabilities 파일 수정

---

## 영역 #6: Claude SDK Nested Session

**파일**: `src-tauri/src/lib.rs` (`spawn_server` 함수)

**검사 패턴**:
```rust
// 반드시 env_remove 되어야 하는 변수들
"CLAUDECODE"
"CLAUDE_CODE_*"  // 패턴 매칭
"ANTHROPIC_*"    // 패턴 매칭
```

**회귀 트리거**: `spawn_server` 함수 수정, 새 환경변수 추가 시

---

## 영역 #7: Provider CLI Pre-flight

**파일**: `app/server/index.js`

**검사 패턴**:
```javascript
// pre-flight: binary 존재 확인
// command -v <binary> 사용

// spawnSync 사용 시 올바른 방식
spawnSync('command -v binary && command args', { shell: true })  // ✅
spawnSync('command', ['arg1', 'arg2'], { shell: true })          // ❌ (sh positional args로 먹힘)
```

**회귀 트리거**: `server/index.js` Provider spawn 로직 수정

---

## 빠른 grep 명령어

```bash
# 영역 #1: peekSlot / getSlot 패턴
grep -n "getSlot\|peekSlot\|pendingViewSession" app/src/components/chat/hooks/useChatSessionState.ts

# 영역 #2: 삭제 방지 로직
grep -n "recentlyDeleted\|projects_updated" app/src/hooks/useProjectsState.ts

# 영역 #3: tail isolation
grep -n "stableChatMessages\|tailChatMessage" app/src/components/chat/hooks/useChatSessionState.ts

# 영역 #4: 줌 메뉴
grep -n "view_submenu\|apply_zoom\|on_menu_event" src-tauri/src/lib.rs

# 영역 #5: drag region
grep -rn "tauri-drag-region\|allow-start-dragging" app/src/components/app/AppContent.tsx src-tauri/capabilities/

# 영역 #6: env_remove
grep -n "env_remove\|CLAUDECODE\|ANTHROPIC_" src-tauri/src/lib.rs

# 영역 #7: pre-flight
grep -n "command -v\|spawnSync" app/server/index.js
```
