import { useCallback, useEffect, useState } from 'react';

/**
 * Vienna 디자인 시스템 토큰
 * --------------------------------------------------------------
 * 사용자가 직접 조정 가능한 색/폰트 토큰을 단일 hook 으로 묶는다.
 *
 * - background : "A 색상". 컨텐츠 영역의 베이스 색.
 *                사이드바는 이 색에서 lightness 12% 만큼 밝게 자동 파생.
 * - accent     : 강조 색 (primary 버튼, 링크, 포커스 링 등).
 * - foreground : 텍스트 색.
 * - uiFont     : UI 전체에 적용되는 font-family.
 * - codeFont   : 코드/모노스페이스 영역에 적용되는 font-family.
 *
 * 적용 방식:
 * - 색은 `<html>` 의 inline `--background` / `--sidebar-background` /
 *   `--primary` / `--ring` / `--foreground` 변수를 직접 덮어쓴다.
 *   기존 Tailwind class (`bg-background` 등) 가 자동으로 따라온다.
 * - 폰트는 `<html>` 의 `--font-ui` / `--font-code` 변수를 덮어쓰고,
 *   index.css 에서 body / code, pre / .vienna-mono 가 이를 사용한다.
 */

const STORAGE_KEY = 'vienna-design-tokens';
const TOKENS_CHANGED_EVENT = 'vienna-design-tokens-changed';

// 사이드바는 background 보다 이만큼 밝다 (사이드바 한 곳만 자동 파생)
const SIDEBAR_LIFT_PERCENT = 12;

export type DesignTokens = {
  background: string;   // hex e.g. "#000000"
  accent: string;       // hex e.g. "#339CFF"
  foreground: string;   // hex e.g. "#FFFFFF"
  uiFont: string;       // CSS font-family value
  codeFont: string;     // CSS font-family value
};

export const DEFAULT_TOKENS: DesignTokens = {
  background: '#000000',
  accent: '#339CFF',
  foreground: '#FFFFFF',
  uiFont:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  codeFont:
    "ui-monospace, 'SF Mono', 'Cascadia Mono', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace",
};

// === 색 변환 유틸 ============================================================

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizeHex = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '#000000';
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const r = withHash[1];
    const g = withHash[2];
    const b = withHash[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return '#000000';
};

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = normalizeHex(hex).slice(1);
  const num = parseInt(normalized, 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
};

/**
 * Hex → HSL space-separated string for Tailwind tokens.
 * Returns "H S% L%" (e.g. "0 0% 0%").
 */
const hexToHslString = (hex: string): string => {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        break;
    }
    h *= 60;
  }

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

/** Hex → HSL with a Lightness offset (used for sidebar lift). */
const hexToHslStringLifted = (hex: string, liftL: number): string => {
  const base = hexToHslString(hex);
  // base looks like "H S% L%"
  const match = base.match(/^(\d+) (\d+)% (\d+)%$/);
  if (!match) return base;
  const [, h, s, l] = match;
  const lifted = clamp(parseInt(l, 10) + liftL, 0, 100);
  return `${h} ${s}% ${lifted}%`;
};

// === 저장/불러오기 ===========================================================

const readStoredTokens = (): DesignTokens => {
  if (typeof window === 'undefined') return DEFAULT_TOKENS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TOKENS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_TOKENS;
    return {
      background: normalizeHex(parsed.background || DEFAULT_TOKENS.background),
      accent: normalizeHex(parsed.accent || DEFAULT_TOKENS.accent),
      foreground: normalizeHex(parsed.foreground || DEFAULT_TOKENS.foreground),
      uiFont: typeof parsed.uiFont === 'string' && parsed.uiFont ? parsed.uiFont : DEFAULT_TOKENS.uiFont,
      codeFont:
        typeof parsed.codeFont === 'string' && parsed.codeFont ? parsed.codeFont : DEFAULT_TOKENS.codeFont,
    };
  } catch {
    return DEFAULT_TOKENS;
  }
};

const writeStoredTokens = (tokens: DesignTokens) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    /* ignore quota errors */
  }
};

// === 적용 ====================================================================

const applyTokensToDocument = (tokens: DesignTokens) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // === 색 ===
  // background : 컨텐츠 영역(사이드바 우측 전체)의 wide 배경.
  // sidebar-background : background 에서 +12% lightness 만큼 자동 파생.
  // 그 외 surface 토큰(card, popover, secondary 등)은 손대지 않는다.
  // → chat composer / 드롭다운 등 작은 패널은 기존 톤을 유지한다.
  root.style.setProperty('--background', hexToHslString(tokens.background));
  root.style.setProperty(
    '--sidebar-background',
    hexToHslStringLifted(tokens.background, SIDEBAR_LIFT_PERCENT),
  );
  // 폰트
  root.style.setProperty('--font-ui', tokens.uiFont);
  root.style.setProperty('--font-code', tokens.codeFont);
};

// === Hook ===================================================================

export function useDesignTokens() {
  const [tokens, setTokens] = useState<DesignTokens>(() => readStoredTokens());

  // 초기 마운트 시 한 번, 그리고 변경될 때마다 적용
  useEffect(() => {
    applyTokensToDocument(tokens);
    writeStoredTokens(tokens);
    // 다른 useDesignTokens 인스턴스(예: AppContent vs Settings)가
    // 같은 토큰을 동기화 보유하도록 broadcast.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<DesignTokens>(TOKENS_CHANGED_EVENT, { detail: tokens }),
      );
    }
  }, [tokens]);

  // 다른 인스턴스에서 토큰이 바뀌었을 때 상태를 동기화
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<DesignTokens>).detail;
      if (!detail) return;
      // 동일한 객체면 setState 가 불필요한 렌더를 일으키지 않게 string 비교
      const same = JSON.stringify(detail) === JSON.stringify(tokens);
      if (!same) setTokens(detail);
    };
    window.addEventListener(TOKENS_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(TOKENS_CHANGED_EVENT, handler as EventListener);
  }, [tokens]);

  const updateToken = useCallback(<K extends keyof DesignTokens>(key: K, value: DesignTokens[K]) => {
    setTokens((prev) => {
      const next = { ...prev, [key]: value } as DesignTokens;
      // hex 정규화 (color 필드만)
      if (key === 'background' || key === 'accent' || key === 'foreground') {
        next[key] = normalizeHex(value as string) as DesignTokens[K];
      }
      return next;
    });
  }, []);

  const resetTokens = useCallback(() => {
    setTokens(DEFAULT_TOKENS);
  }, []);

  return {
    tokens,
    updateToken,
    resetTokens,
  };
}

/**
 * 앱 부팅 시점에 저장된 토큰을 즉시 적용하는 helper.
 * React mount 보다 먼저 호출되어야 하는 경우(예: <body> 의 첫 페인트 전)
 * main.tsx 등에서 호출한다.
 */
export const bootstrapDesignTokens = () => {
  applyTokensToDocument(readStoredTokens());
};
