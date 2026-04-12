import { useEffect, useRef, useState } from 'react';

interface TextRevealProps {
  text: string;
  className?: string;
}

type Phase = 'idle' | 'exit' | 'enter';

const DURATION_MS = 200;

const PHASE_STYLES: Record<Phase, React.CSSProperties> = {
  exit: { opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' },
  enter: { opacity: 0, transform: 'translateY(-8px)', filter: 'blur(4px)' },
  idle: { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
};

/**
 * Animated text component that reveals text with a blur+slide effect.
 * When `text` changes:
 *   1. Old text slides down and blurs out (exit)
 *   2. New text slides in from above (enter -> idle)
 */
export default function TextReveal({ text, className = '' }: TextRevealProps) {
  const [displayText, setDisplayText] = useState(text);
  const [phase, setPhase] = useState<Phase>('idle');
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (text === displayText) {
      return;
    }

    setPhase('exit');

    timerRef.current = setTimeout(() => {
      setDisplayText(text);
      setPhase('enter');

      // Double rAF ensures the 'enter' style is painted before
      // transitioning to 'idle', so the CSS transition actually fires.
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setPhase('idle');
        });
      });
    }, DURATION_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span
      className={`text-reveal-container ${className}`}
      style={{ overflow: 'hidden', display: 'inline-block' }}
    >
      <span className="text-reveal-inner" style={PHASE_STYLES[phase]}>
        {displayText}
      </span>
    </span>
  );
}
