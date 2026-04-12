import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { hexToHsv, hsvToHex, isValidHex, type HSV } from '../../utils/color';

// During drag we bypass React state entirely and mutate the DOM directly.
// This avoids 3× setState per pointermove, eliminating jank.
// React state is synced once on pointerup.

/**
 * Inline color picker matching the Codex / modern design-tool style:
 *
 *   ┌───────────────┐  #RRGGBB
 *   │ saturation    │
 *   │   /value      │
 *   │   square      │
 *   └───────────────┘
 *   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  hue strip
 *
 * Drag inside the SV square to pick saturation/value, drag the hue strip
 * to change the base hue. The current color is rendered as a small swatch
 * trigger button; clicking it toggles the popover open/closed. Clicking
 * outside (or pressing Esc) closes the popover.
 *
 * The component is fully self-contained — no portals, no global click
 * listeners outside the click-outside cleanup.
 */

type ColorPickerPopoverProps = {
  /** Current color value as `#RRGGBB`. Empty / invalid is treated as black. */
  value: string;
  /** Called on commit (pointerup / hex input blur). Updates React state. */
  onChange: (next: string) => void;
  /** Called on every drag tick for real-time DOM-only preview. Optional.
   *  If not provided, onChange is called during drag (slower). */
  onLiveChange?: (next: string) => void;
  /** Optional aria-label for the trigger swatch. */
  ariaLabel?: string;
  /** Optional className for the outer wrapper. */
  className?: string;
};

const SWATCH_SIZE = 36; // matches the previous round swatch
const SQUARE_SIZE = 200;
const HUE_HEIGHT = 12;

const safeHexToHsv = (hex: string): HSV => {
  const parsed = hexToHsv(hex);
  if (parsed) return parsed;
  return { h: 0, s: 0, v: 0 };
};

export default function ColorPickerPopover({
  value,
  onChange,
  onLiveChange,
  ariaLabel = '색상 선택',
  className,
}: ColorPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<HSV>(() => safeHexToHsv(value));
  const [hexInput, setHexInput] = useState(value);

  // Re-sync internal state when the parent's value changes from outside
  // (e.g. reset-to-defaults button). Avoid clobbering during active drags.
  const isDraggingRef = useRef(false);
  useEffect(() => {
    if (isDraggingRef.current) return;
    const next = safeHexToHsv(value);
    setHsv(next);
    setHexInput(value);
  }, [value]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Esc
  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Live HSV ref — mutated during drag without React re-render.
  const liveHsvRef = useRef(hsv);
  liveHsvRef.current = hsv;

  // DOM element refs for direct mutation during drag
  const svThumbRef = useRef<HTMLDivElement | null>(null);
  const hueThumbRef = useRef<HTMLDivElement | null>(null);
  const previewSwatchRef = useRef<HTMLSpanElement | null>(null);
  const hexDisplayRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Apply HSV to DOM directly (no React state) — called via rAF during drag
  const liveChangeFn = onLiveChange || onChange;
  const applyHsvToDOM = useCallback((next: HSV) => {
    const hex = hsvToHex(next);
    // Update SV thumb position
    if (svThumbRef.current) {
      svThumbRef.current.style.left = `${next.s}%`;
      svThumbRef.current.style.top = `${100 - next.v}%`;
    }
    // Update hue thumb position
    if (hueThumbRef.current) {
      hueThumbRef.current.style.left = `${(next.h / 360) * 100}%`;
    }
    // Update preview swatch color
    if (previewSwatchRef.current) {
      previewSwatchRef.current.style.backgroundColor = hex;
    }
    // Update hex display
    if (hexDisplayRef.current) {
      hexDisplayRef.current.value = hex;
    }
    // Apply to document CSS variables immediately (DOM-only, no React)
    liveChangeFn(hex);
  }, [liveChangeFn]);

  // Commit final value to React state (called once on pointerup)
  const finalizeHsv = useCallback((next: HSV) => {
    const hex = hsvToHex(next);
    setHsv(next);
    setHexInput(hex);
    // onChange already called during drag, but call once more to ensure sync
    onChange(hex);
  }, [onChange]);

  // ── SV square dragging (rAF-throttled, DOM-only) ──────────────────────
  const handleSvPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    isDraggingRef.current = true;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const w = target.offsetWidth || 1;
    const h = target.offsetHeight || 1;
    const s = Math.min(100, Math.max(0, (event.nativeEvent.offsetX / w) * 100));
    const v = Math.min(100, Math.max(0, (1 - event.nativeEvent.offsetY / h) * 100));
    const next = { h: liveHsvRef.current.h, s, v };
    liveHsvRef.current = next;
    applyHsvToDOM(next);
  };
  const handleSvPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const target = event.currentTarget;
    const ox = event.nativeEvent.offsetX;
    const oy = event.nativeEvent.offsetY;
    // Throttle to rAF — skip if a frame is already pending
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const w = target.offsetWidth || 1;
      const h = target.offsetHeight || 1;
      const s = Math.min(100, Math.max(0, (ox / w) * 100));
      const v = Math.min(100, Math.max(0, (1 - oy / h) * 100));
      const next = { h: liveHsvRef.current.h, s, v };
      liveHsvRef.current = next;
      applyHsvToDOM(next);
    });
  };
  const handleSvPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    finalizeHsv(liveHsvRef.current);
  };

  // ── Hue strip dragging (rAF-throttled, DOM-only) ──────────────────────
  const handleHuePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    isDraggingRef.current = true;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const w = target.offsetWidth || 1;
    const h = Math.min(360, Math.max(0, (event.nativeEvent.offsetX / w) * 360));
    const next = { h, s: liveHsvRef.current.s, v: liveHsvRef.current.v };
    liveHsvRef.current = next;
    applyHsvToDOM(next);
    // Update SV square background for new hue
    if (svRef.current) {
      svRef.current.style.backgroundColor = hsvToHex({ h, s: 100, v: 100 });
    }
  };
  const handleHuePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const target = event.currentTarget;
    const ox = event.nativeEvent.offsetX;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const w = target.offsetWidth || 1;
      const h = Math.min(360, Math.max(0, (ox / w) * 360));
      const next = { h, s: liveHsvRef.current.s, v: liveHsvRef.current.v };
      liveHsvRef.current = next;
      applyHsvToDOM(next);
      if (svRef.current) {
        svRef.current.style.backgroundColor = hsvToHex({ h, s: 100, v: 100 });
      }
    });
  };
  const handleHuePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    finalizeHsv(liveHsvRef.current);
  };

  // ── Hex text input ────────────────────────────────────────────────────
  const commitHexInput = (raw: string) => {
    const trimmed = raw.trim();
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (isValidHex(withHash)) {
      const upper = withHash.toUpperCase();
      onChange(upper);
      setHsv(safeHexToHsv(upper));
      setHexInput(upper);
    } else {
      // revert
      setHexInput(value);
    }
  };

  const handleHexKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      (event.currentTarget as HTMLInputElement).blur();
    }
  };

  // Memoised CSS for the SV square — base hue color (full saturation/value)
  // overlaid with white→transparent (left→right) and transparent→black
  // (top→bottom) gradients. This is the standard Photoshop-style picker.
  const svSquareStyle = useMemo<CSSProperties>(() => {
    const baseHueRgb = hsvToHex({ h: hsv.h, s: 100, v: 100 });
    return {
      width: SQUARE_SIZE,
      height: SQUARE_SIZE,
      backgroundColor: baseHueRgb,
      backgroundImage:
        'linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, transparent 100%)',
      borderRadius: 6,
      position: 'relative',
      cursor: 'crosshair',
      userSelect: 'none',
      touchAction: 'none',
    };
  }, [hsv.h]);

  // Position the thumb in PERCENTAGES of the parent square, not pixels
  // derived from the SQUARE_SIZE constant. The constant only describes
  // the *intended* size — Vienna's Cmd+= zoom (CSS `zoom` property) and
  // any ancestor transform can rescale the actual rendered square. The
  // click math uses `rect.width`/`rect.height` (real rendered values) so
  // if the thumb math used the constant they'd disagree, producing a
  // systematic horizontal offset between the cursor and the thumb. Using
  // percentages keeps both in sync regardless of zoom.
  //
  // `transform: translate(-50%, -50%)` centers the thumb glyph on the
  // computed point so the visual center (not the top-left corner) tracks
  // the cursor.
  const svThumbStyle = useMemo<CSSProperties>(() => {
    return {
      position: 'absolute',
      left: `${hsv.s}%`,
      top: `${100 - hsv.v}%`,
      width: 14,
      height: 14,
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      border: '2px solid white',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4)',
      pointerEvents: 'none',
    };
  }, [hsv.s, hsv.v]);

  const hueStripStyle: CSSProperties = {
    width: SQUARE_SIZE,
    height: HUE_HEIGHT,
    background:
      'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
    borderRadius: 6,
    position: 'relative',
    cursor: 'pointer',
    userSelect: 'none',
    touchAction: 'none',
  };

  // Same percentage trick as svThumbStyle: position the hue thumb based
  // on hue/360 so it tracks the actual rendered hue strip width even
  // under CSS zoom or ancestor transforms.
  const hueThumbStyle: CSSProperties = {
    position: 'absolute',
    left: `${(hsv.h / 360) * 100}%`,
    top: -2,
    width: 12,
    height: HUE_HEIGHT + 4,
    transform: 'translateX(-50%)',
    borderRadius: 3,
    border: '2px solid white',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
    pointerEvents: 'none',
  };

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: SWATCH_SIZE,
          height: SWATCH_SIZE,
          borderRadius: '50%',
          backgroundColor: value,
          border: '1px solid var(--vienna-border, rgba(255,255,255,0.15))',
          cursor: 'pointer',
          padding: 0,
        }}
      />
      <input
        type="text"
        value={hexInput}
        onChange={(event) => setHexInput(event.target.value)}
        onBlur={(event) => commitHexInput(event.target.value)}
        onKeyDown={handleHexKeyDown}
        spellCheck={false}
        className="w-28 rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm uppercase text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {open && (
        <div
          role="dialog"
          aria-label="컬러 선택"
          style={{
            position: 'absolute',
            top: SWATCH_SIZE + 12,
            // Anchor to the RIGHT edge of the trigger so the popover
            // extends leftward. The Background row in settings sits flush
            // against the right side of the panel, and an `left: 0`
            // anchor was clipping the popover off the right edge of the
            // viewport. Right-anchoring keeps the entire SV square
            // visible regardless of window width.
            right: 0,
            zIndex: 50,
            padding: 12,
            borderRadius: 12,
            backgroundColor: 'var(--vienna-popover-bg, rgba(24,24,28,0.98))',
            border: '1px solid var(--vienna-border, rgba(255,255,255,0.12))',
            boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            ref={svRef}
            style={svSquareStyle}
            onPointerDown={handleSvPointerDown}
            onPointerMove={handleSvPointerMove}
            onPointerUp={handleSvPointerUp}
            onPointerCancel={handleSvPointerUp}
          >
            <div ref={svThumbRef} style={svThumbStyle} />
          </div>

          <div
            ref={hueRef}
            style={hueStripStyle}
            onPointerDown={handleHuePointerDown}
            onPointerMove={handleHuePointerMove}
            onPointerUp={handleHuePointerUp}
            onPointerCancel={handleHuePointerUp}
          >
            <div ref={hueThumbRef} style={hueThumbStyle} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span
              ref={previewSwatchRef}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: value,
                border: '1px solid rgba(255,255,255,0.15)',
                flexShrink: 0,
              }}
            />
            <input
              ref={hexDisplayRef}
              type="text"
              value={hexInput}
              onChange={(event) => setHexInput(event.target.value)}
              onBlur={(event) => commitHexInput(event.target.value)}
              onKeyDown={handleHexKeyDown}
              spellCheck={false}
              className="w-full rounded-md border border-input bg-card px-2 py-1 font-mono text-xs uppercase text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      )}
    </div>
  );
}
