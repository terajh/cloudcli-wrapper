import React, { useState, useRef, useCallback, useEffect } from 'react';

interface CollapsibleSectionProps {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable collapsible section with smooth height/opacity animation.
 *
 * Replaces native <details>/<summary> so we can transition max-height
 * and opacity. Exposes `data-collapsible-open` for external expand
 * (e.g. IntersectionObserver in MessageComponent).
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  onTitleClick,
  children,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(open);
  const contentRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sync with external `open` prop changes (e.g. autoExpandTools)
  useEffect(() => {
    if (open && !isOpen) {
      setIsOpen(true);
    }
  }, [open]);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // After expanding, remove the inline max-height so content can grow
  // (e.g. streaming content that gets taller while open).
  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName === 'max-height' && isOpen && wrapperRef.current) {
      wrapperRef.current.style.maxHeight = 'none';
    }
  }, [isOpen]);

  // Compute the target max-height right before the browser paints so the
  // CSS transition has a concrete pixel value to interpolate toward.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    if (isOpen) {
      // Set to scrollHeight so the transition animates from 0 -> measured px
      wrapper.style.maxHeight = `${content.scrollHeight}px`;
    } else {
      // When closing: first pin to current height, then on next frame set to 0
      // so the transition fires.
      wrapper.style.maxHeight = `${content.scrollHeight}px`;
      // Force reflow so the browser registers the starting value
      void wrapper.offsetHeight;
      wrapper.style.maxHeight = '0px';
    }
  }, [isOpen]);

  return (
    <div
      className={`group/collapsible relative ${className}`}
      data-collapsible-open={isOpen ? 'true' : 'false'}
    >
      {/* Header / toggle bar */}
      <button
        type="button"
        onClick={toggle}
        className={[
          'flex w-full cursor-pointer select-none items-center gap-1.5 py-0.5 text-left text-xs',
          isOpen
            ? 'sticky top-0 z-10 -mx-1 bg-background px-1'
            : ''
        ].join(' ')}
      >
        <svg
          className={[
            'h-3 w-3 flex-shrink-0 text-gray-400 transition-transform duration-150 dark:text-gray-500',
            isOpen ? 'rotate-90' : ''
          ].join(' ')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {toolName && (
          <span className="flex-shrink-0 font-medium text-gray-500 dark:text-gray-400">{toolName}</span>
        )}
        {toolName && (
          <span className="flex-shrink-0 text-[10px] text-gray-300 dark:text-gray-600">/</span>
        )}
        {onTitleClick ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTitleClick(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onTitleClick(); } }}
            className="flex-1 truncate text-left font-mono text-blue-600 transition-colors hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
          >
            {title}
          </span>
        ) : (
          <span className="flex-1 truncate text-gray-600 dark:text-gray-400">
            {title}
          </span>
        )}
        {action && <span className="ml-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>{action}</span>}
      </button>

      {/* Animated content wrapper */}
      <div
        ref={wrapperRef}
        className="overflow-hidden transition-[max-height,opacity] ease-out"
        style={{
          maxHeight: isOpen ? undefined : '0px',
          opacity: isOpen ? 1 : 0,
          transitionDuration: isOpen ? '200ms' : '150ms',
          transitionTimingFunction: isOpen ? 'ease-out' : 'ease-in',
        }}
        onTransitionEnd={handleTransitionEnd}
      >
        <div ref={contentRef} className="mt-1.5 pl-[18px]">
          {children}
        </div>
      </div>
    </div>
  );
};
