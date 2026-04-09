---
name: vienna-team
description: "Vienna 하네스 팀 오케스트레이터. 작업 유형에 따라 글로벌/Vienna 전용 에이전트를 조합. vienna team, 하네스 팀, 팀 조율, 어떤 에이전트 키워드로 호출."
---

# Vienna Team — 하네스 오케스트레이터

Vienna 작업을 상황에 따라 최적의 에이전트 조합으로 처리합니다.

## 에이전트 팀 전체 구조

### Vienna 전용 에이전트 (신규)
| 에이전트 | 역할 | 트리거 |
|----------|------|--------|
| `vienna-regression-guard` | 7개 위험 영역 회귀 분석 | 코드 변경 후 |
| `vienna-release` | 릴리즈 빌드 + GitHub 업로드 | 배포 시 |
| `vienna-dev-cycle` | 레이어별 빌드 & 재시작 | 개발 중 |
| `vienna-debug` | 로그 분석 & 문제 진단 | 오류 발생 시 |

### 글로벌 에이전트 (재사용)
| 에이전트 | Vienna에서 쓰는 시점 |
|----------|---------------------|
| `planner` | 복잡한 기능 구현 전 계획 |
| `architect` | Tauri/Express 아키텍처 결정 |
| `tdd-guide` | 위험 영역 코드 변경 시 테스트 |
| `code-reviewer` | 회귀 분석 후 일반 품질 리뷰 |
| `security-reviewer` | 릴리즈 전 보안 검토 |
| `build-error-resolver` | 빌드 실패 진단 |
| `e2e-runner` | 핵심 사용자 흐름 검증 |

## 시나리오별 에이전트 조합

### 시나리오 A: 새 기능 구현

```
[planner]
   ↓ 구현 계획
[tdd-guide]          ← 위험 영역 건드리면 테스트 먼저
   ↓ 구현
[vienna-regression-guard]   ← 위험 영역 회귀 체크
   ↓ 위험 없음
[code-reviewer]      ← 일반 품질 리뷰
   ↓ 승인
[vienna-dev-cycle]   ← 빌드 & 검증
```

### 시나리오 B: 릴리즈

```
[vienna-regression-guard]   ← 최종 회귀 체크 (병렬)
[security-reviewer]          ← 보안 검토 (병렬)
         ↓ 둘 다 통과
[vienna-release]             ← 빌드 + GitHub 업로드
```

### 시나리오 C: 오류 디버깅

```
[vienna-debug]               ← 로그 분석 & 패턴 매칭
   ↓ 원인 파악
   ├── 빌드 오류 → [build-error-resolver]
   ├── 회귀 의심 → [vienna-regression-guard]
   └── 재시작 필요 → [vienna-dev-cycle]
```

### 시나리오 D: React UI 수정 (위험 영역 포함)

```
[vienna-dev-cycle]           ← typecheck + build
   ↓
[vienna-regression-guard]   ← useChatSessionState 변경 시 필수
   ↓ GREEN 또는 YELLOW
[tdd-guide]                  ← RED 영역이면 테스트 추가
   ↓
[code-reviewer]
```

### 시나리오 E: Rust/Tauri 수정

```
[architect]                  ← 아키텍처 영향 검토 (필요 시)
   ↓
[vienna-regression-guard]   ← lib.rs 변경 = 영역 #4, #5, #6
   ↓
[vienna-dev-cycle]           ← cargo tauri dev
```

## 스킬 ↔ 에이전트 매핑

| 스킬 | 주 에이전트 | 보조 에이전트 |
|------|------------|--------------|
| `vienna-dev` | `vienna-dev-cycle` | `build-error-resolver` |
| `vienna-release` | `vienna-release` | `security-reviewer` |
| `vienna-regression-check` | `vienna-regression-guard` | `tdd-guide` |
| `vienna-debug` | `vienna-debug` | `vienna-dev-cycle` |

## 빠른 참조

```bash
# 어떤 에이전트를 써야 할지 모를 때
# 1. 무엇을 하려는가?
#    - 코드 변경 후 안전 확인 → vienna-regression-guard
#    - 오류 발생 → vienna-debug
#    - 빌드/재시작 → vienna-dev-cycle
#    - 릴리즈 → vienna-release

# 2. 글로벌 에이전트를 쓸 때는?
#    - 새 기능 복잡도 높음 → planner 먼저
#    - 커밋 전 코드 품질 → code-reviewer
#    - 보안 민감 변경 → security-reviewer
```
