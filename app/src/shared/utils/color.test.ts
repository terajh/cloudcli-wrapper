import { describe, expect, it } from 'vitest';
import {
  clamp,
  expandShortHex,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  isValidHex,
  pickReadableForeground,
  rgbToHex,
  rgbToHsv,
} from './color';

// --- clamp ---------------------------------------------------------------

describe('clamp', () => {
  it('returns n unchanged when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('clamps to min', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it('clamps to max', () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

// --- isValidHex / expandShortHex ----------------------------------------

describe('isValidHex', () => {
  it('accepts 6-digit hex with hash', () => {
    expect(isValidHex('#ffffff')).toBe(true);
    expect(isValidHex('#000000')).toBe(true);
    expect(isValidHex('#1A2B3C')).toBe(true);
  });
  it('accepts 3-digit hex with hash', () => {
    expect(isValidHex('#abc')).toBe(true);
    expect(isValidHex('#FFF')).toBe(true);
  });
  it('rejects missing hash', () => {
    expect(isValidHex('ffffff')).toBe(false);
  });
  it('rejects non-hex characters', () => {
    expect(isValidHex('#gghhii')).toBe(false);
  });
  it('rejects wrong length', () => {
    expect(isValidHex('#ffff')).toBe(false);
    expect(isValidHex('#fffffff')).toBe(false);
  });
  it('rejects non-string', () => {
    expect(isValidHex(undefined as unknown as string)).toBe(false);
    expect(isValidHex(null as unknown as string)).toBe(false);
  });
});

describe('expandShortHex', () => {
  it('expands 3-digit to 6-digit', () => {
    expect(expandShortHex('#abc')).toBe('#aabbcc');
    expect(expandShortHex('#F0E')).toBe('#FF00EE');
  });
  it('passes through 6-digit unchanged', () => {
    expect(expandShortHex('#abcdef')).toBe('#abcdef');
  });
});

// --- hexToRgb / rgbToHex roundtrip --------------------------------------

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
  });
  it('parses 3-digit hex via expansion', () => {
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
  });
  it('returns null for invalid hex', () => {
    expect(hexToRgb('#gggggg')).toBeNull();
    expect(hexToRgb('not a color')).toBeNull();
  });
});

describe('rgbToHex', () => {
  it('emits upper-case 6-digit hex with hash', () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF');
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#FF0000');
  });
  it('clamps out-of-range components', () => {
    expect(rgbToHex({ r: -10, g: 300, b: 128 })).toBe('#00FF80');
  });
  it('rounds floats', () => {
    expect(rgbToHex({ r: 127.5, g: 127.4, b: 0 })).toBe('#807F00');
  });
  it('roundtrips with hexToRgb for canonical colours', () => {
    const cases = ['#000000', '#FFFFFF', '#FF8800', '#1A2B3C', '#AABBCC'];
    for (const hex of cases) {
      const rgb = hexToRgb(hex);
      expect(rgbToHex(rgb!)).toBe(hex.toUpperCase());
    }
  });
});

// --- rgbToHsv / hsvToRgb -------------------------------------------------

describe('rgbToHsv', () => {
  it('handles black', () => {
    const hsv = rgbToHsv({ r: 0, g: 0, b: 0 });
    expect(hsv).toEqual({ h: 0, s: 0, v: 0 });
  });
  it('handles white', () => {
    const hsv = rgbToHsv({ r: 255, g: 255, b: 255 });
    expect(hsv.h).toBe(0);
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBe(100);
  });
  it('handles pure red', () => {
    const hsv = rgbToHsv({ r: 255, g: 0, b: 0 });
    expect(hsv.h).toBeCloseTo(0, 5);
    expect(hsv.s).toBeCloseTo(100, 5);
    expect(hsv.v).toBeCloseTo(100, 5);
  });
  it('handles pure green', () => {
    const hsv = rgbToHsv({ r: 0, g: 255, b: 0 });
    expect(hsv.h).toBeCloseTo(120, 5);
  });
  it('handles pure blue', () => {
    const hsv = rgbToHsv({ r: 0, g: 0, b: 255 });
    expect(hsv.h).toBeCloseTo(240, 5);
  });
});

describe('hsvToRgb', () => {
  it('handles edge hues correctly', () => {
    const cases: Array<[number, { r: number; g: number; b: number }]> = [
      [0, { r: 255, g: 0, b: 0 }],
      [60, { r: 255, g: 255, b: 0 }],
      [120, { r: 0, g: 255, b: 0 }],
      [180, { r: 0, g: 255, b: 255 }],
      [240, { r: 0, g: 0, b: 255 }],
      [300, { r: 255, g: 0, b: 255 }],
    ];
    for (const [h, expected] of cases) {
      const rgb = hsvToRgb({ h, s: 100, v: 100 });
      expect(Math.round(rgb.r)).toBe(expected.r);
      expect(Math.round(rgb.g)).toBe(expected.g);
      expect(Math.round(rgb.b)).toBe(expected.b);
    }
  });
  it('handles s=0 (grey)', () => {
    const rgb = hsvToRgb({ h: 200, s: 0, v: 50 });
    // s=0 → all channels equal regardless of hue. 50% v → 0.5 * 255 = 127.5
    // which rounds to 128. The point of the test is "all three are equal".
    expect(Math.round(rgb.r)).toBe(Math.round(rgb.g));
    expect(Math.round(rgb.g)).toBe(Math.round(rgb.b));
    expect(Math.round(rgb.r)).toBe(128);
  });
  it('clamps out-of-range hsv', () => {
    const rgb = hsvToRgb({ h: 360, s: 200, v: -10 });
    expect(Math.round(rgb.r)).toBe(0);
    expect(Math.round(rgb.g)).toBe(0);
    expect(Math.round(rgb.b)).toBe(0);
  });
});

// --- hex ↔ hsv roundtrip -------------------------------------------------

describe('hex ↔ hsv roundtrip', () => {
  it('converts canonical palette colors round-trip lossless to ±1 unit', () => {
    const palette = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FF8800', '#3B82F6', '#9333EA'];
    for (const hex of palette) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      const back = hsvToHex(hsv!);
      // Round-trip should match exactly for canonical colors.
      expect(back).toBe(hex.toUpperCase());
    }
  });
});

// --- pickReadableForeground ---------------------------------------------

describe('pickReadableForeground', () => {
  it('picks white on dark backgrounds', () => {
    expect(pickReadableForeground('#000000')).toBe('#FFFFFF');
    expect(pickReadableForeground('#1a1a1a')).toBe('#FFFFFF');
    expect(pickReadableForeground('#0000FF')).toBe('#FFFFFF');
  });
  it('picks black on light backgrounds', () => {
    expect(pickReadableForeground('#FFFFFF')).toBe('#000000');
    expect(pickReadableForeground('#F0F0F0')).toBe('#000000');
    expect(pickReadableForeground('#FFFF00')).toBe('#000000');
  });
  it('falls back to white for invalid hex', () => {
    expect(pickReadableForeground('not a color')).toBe('#FFFFFF');
  });
});
