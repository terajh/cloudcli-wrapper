/**
 * Pure color conversion helpers used by the custom ColorPickerPopover.
 *
 * Why a custom picker:
 * - The native <input type="color"> opens the macOS system color panel,
 *   which feels foreign inside a dark Tauri webview and doesn't match
 *   the rest of the app's design language.
 * - Codex (and most modern design tools) use an inline SV-square + hue-
 *   slider picker. We replicate that here.
 *
 * All functions are pure and deterministic so they can be unit-tested
 * without spinning up a DOM.
 *
 * Color space terminology:
 *   - HEX:  '#RRGGBB' or '#RGB' (we always emit upper-case 6-digit form)
 *   - RGB:  { r: 0..255, g: 0..255, b: 0..255 }
 *   - HSV:  { h: 0..360 (degrees), s: 0..100 (%), v: 0..100 (%) }
 */

export type RGB = { r: number; g: number; b: number };
export type HSV = { h: number; s: number; v: number };

/** Clamp `n` to the inclusive range [`min`, `max`]. */
export const clamp = (n: number, min: number, max: number): number => {
  if (n < min) return min;
  if (n > max) return max;
  return n;
};

/** Strict hex check: `#RGB` (3 digits) or `#RRGGBB` (6 digits). */
export const isValidHex = (hex: string): boolean => {
  if (typeof hex !== 'string') return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
};

/** Expand `#RGB` to `#RRGGBB`. Idempotent for already-6-digit values. */
export const expandShortHex = (hex: string): string => {
  const trimmed = hex.trim();
  const m = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (!m) return trimmed;
  const [r, g, b] = m[1].split('');
  return `#${r}${r}${g}${g}${b}${b}`;
};

/** `#RRGGBB` → `{ r, g, b }` (0..255 each). Returns `null` if invalid. */
export const hexToRgb = (hex: string): RGB | null => {
  if (!isValidHex(hex)) return null;
  const expanded = expandShortHex(hex);
  return {
    r: parseInt(expanded.slice(1, 3), 16),
    g: parseInt(expanded.slice(3, 5), 16),
    b: parseInt(expanded.slice(5, 7), 16),
  };
};

/** `{ r, g, b }` → `#RRGGBB` (upper-case). Each component clamped to 0..255. */
export const rgbToHex = ({ r, g, b }: RGB): string => {
  const toByte = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`.toUpperCase();
};

/**
 * RGB → HSV conversion.
 *
 * Standard formula:
 *   v = max(r,g,b)
 *   s = (max - min) / max  (or 0 if max is 0)
 *   h = depends on which channel is max
 *
 * Returns h ∈ [0, 360), s ∈ [0, 100], v ∈ [0, 100].
 */
export const rgbToHsv = ({ r, g, b }: RGB): HSV => {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;

  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rN) {
      h = ((gN - bN) / delta) % 6;
    } else if (max === gN) {
      h = (bN - rN) / delta + 2;
    } else {
      h = (rN - gN) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return { h, s, v };
};

/** HSV → RGB conversion. Inputs are clamped to their valid ranges. */
export const hsvToRgb = ({ h, s, v }: HSV): RGB => {
  const hC = ((h % 360) + 360) % 360;
  const sC = clamp(s, 0, 100) / 100;
  const vC = clamp(v, 0, 100) / 100;

  const c = vC * sC;
  const hPrime = hC / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = vC - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime >= 0 && hPrime < 1) {
    r1 = c;
    g1 = x;
  } else if (hPrime < 2) {
    r1 = x;
    g1 = c;
  } else if (hPrime < 3) {
    g1 = c;
    b1 = x;
  } else if (hPrime < 4) {
    g1 = x;
    b1 = c;
  } else if (hPrime < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
  };
};

/** Convenience: hex → hsv (returns null if hex invalid). */
export const hexToHsv = (hex: string): HSV | null => {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
};

/** Convenience: hsv → hex. */
export const hsvToHex = (hsv: HSV): string => rgbToHex(hsvToRgb(hsv));

/**
 * Decide whether white or black foreground text reads more legibly on top
 * of `hex`. Uses the W3C relative luminance formula. Used by the picker
 * to render the swatch's border / focus ring at appropriate contrast.
 */
export const pickReadableForeground = (hex: string): '#000000' | '#FFFFFF' => {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#FFFFFF';
  const linearize = (c: number) => {
    const cN = c / 255;
    return cN <= 0.03928 ? cN / 12.92 : Math.pow((cN + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};
