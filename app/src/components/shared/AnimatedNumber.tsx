import { useMemo } from 'react';

interface AnimatedNumberProps {
  value: number;
  className?: string;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Single digit column that rolls like a mechanical counter.
 * Each digit is a vertical strip of 0-9, translated via CSS translateY.
 */
function DigitColumn({ digit }: { digit: number }) {
  const offset = -(digit * 10);

  return (
    <span
      className="odometer-digit-column"
      style={{
        display: 'inline-block',
        height: '1em',
        overflow: 'hidden',
        verticalAlign: 'top',
      }}
    >
      <span
        className="odometer-digit-strip"
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          transform: `translateY(${offset}%)`,
        }}
      >
        {DIGITS.map((d) => (
          <span
            key={d}
            style={{
              display: 'block',
              height: '1em',
              lineHeight: '1em',
              textAlign: 'center',
            }}
          >
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Odometer-style animated number display.
 * Digits spin like a mechanical counter when the value changes.
 * Formats numbers with locale-based comma separators.
 */
export default function AnimatedNumber({ value, className = '' }: AnimatedNumberProps) {
  const chars = useMemo(() => {
    const formatted = value.toLocaleString();
    return formatted.split('').map((char, index) => ({
      key: `${formatted.length}-${index}`,
      char,
      isDigit: /\d/.test(char),
    }));
  }, [value]);

  return (
    <span
      className={`animated-number ${className}`}
      style={{ display: 'inline-flex', alignItems: 'baseline' }}
      aria-label={value.toLocaleString()}
    >
      {chars.map(({ key, char, isDigit }) =>
        isDigit ? (
          <DigitColumn key={key} digit={Number(char)} />
        ) : (
          <span key={key} style={{ display: 'inline-block' }}>
            {char}
          </span>
        ),
      )}
    </span>
  );
}
