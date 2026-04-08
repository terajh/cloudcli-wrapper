import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

type ClaudeStatusProps = {
  status: {
    text?: string;
    tokens?: number;
    can_interrupt?: boolean;
  } | null;
  onAbort?: () => void;
  isLoading: boolean;
  provider?: string;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
const ANIMATION_STEPS = 40;

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  claude: 'messageTypes.claude',
  codex: 'messageTypes.codex',
  cursor: 'messageTypes.cursor',
  gemini: 'messageTypes.gemini',
};

function formatElapsedTime(totalSeconds: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 1) {
    return t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' });
  }

  return t('claudeStatus.elapsed.minutesSeconds', {
    minutes,
    seconds,
    defaultValue: '{{minutes}}m {{seconds}}s',
  });
}

export default function ClaudeStatus({
  status,
  onAbort,
  isLoading,
  provider = 'claude',
}: ClaudeStatusProps) {
  const { t } = useTranslation('chat');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [animationPhase, setAnimationPhase] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();

    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const timer = window.setInterval(() => {
      setAnimationPhase((previous) => (previous + 1) % ANIMATION_STEPS);
    }, 500);

    return () => window.clearInterval(timer);
  }, [isLoading]);

  // Note: showThinking only controls the reasoning accordion in messages, not this processing indicator
  if (!isLoading && !status) {
    return null;
  }

  const actionWords = ACTION_KEYS.map((key, index) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[index] }));
  const actionIndex = Math.floor(elapsedTime / 3) % actionWords.length;
  const statusText = status?.text || actionWords[actionIndex];
  const cleanStatusText = statusText.replace(/[.]+$/, '');
  const canInterrupt = isLoading && status?.can_interrupt !== false;
  const providerLabelKey = PROVIDER_LABEL_KEYS[provider];
  const providerLabel = providerLabelKey
    ? t(providerLabelKey)
    : t('claudeStatus.providers.assistant', { defaultValue: 'Assistant' });
  const animatedDots = '.'.repeat((animationPhase % 3) + 1);
  const elapsedLabel =
    elapsedTime > 0
      ? t('claudeStatus.elapsed.label', {
          time: formatElapsedTime(elapsedTime, t),
          defaultValue: '{{time}} elapsed',
        })
      : t('claudeStatus.elapsed.startingNow', { defaultValue: 'Starting now' });

  return (
    <div className="animate-in slide-in-from-bottom mb-2 w-full duration-200">
      <div
        className={cn(
          'relative mx-auto flex h-9 w-full max-w-4xl items-center gap-2 overflow-hidden rounded-full px-3 text-xs transition-all',
          // T5 — visibility boost: stronger background and accent border while
          // a run is live so the status pill is unmistakable next to the
          // composer. Falls back to muted styling when paused/idle.
          isLoading
            ? 'border border-primary/40 bg-card/95 shadow-sm ring-1 ring-primary/10'
            : 'border border-border/60 bg-card/80',
        )}
      >
        <div className="relative flex flex-shrink-0 items-center gap-1.5">
          <SessionProviderLogo provider={provider} className="h-3.5 w-3.5" />
          <span className="relative flex h-2 w-2">
            {isLoading && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
            )}
            <span
              className={cn(
                'relative inline-flex h-2 w-2 rounded-full',
                isLoading ? 'bg-emerald-400' : 'bg-amber-400',
              )}
            />
          </span>
        </div>

        <span
          className={cn(
            'flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider',
            isLoading ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {providerLabel}
          {' · '}
          {isLoading
            ? t('claudeStatus.state.live', { defaultValue: 'Live' })
            : t('claudeStatus.state.paused', { defaultValue: 'Paused' })}
        </span>

        <span className="min-w-0 flex-1 truncate font-semibold text-foreground" role="status" aria-live="polite">
          {cleanStatusText}
          {isLoading && (
            <span aria-hidden="true" className="text-primary">
              {animatedDots}
            </span>
          )}
        </span>

        <span className="flex-shrink-0 text-[10px] text-muted-foreground">{elapsedLabel}</span>

        {canInterrupt && onAbort && (
          <button
            type="button"
            onClick={onAbort}
            className="ml-1 inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-semibold text-destructive-foreground transition-opacity hover:opacity-90"
            title={t('claudeStatus.controls.pressEscToStop', { defaultValue: 'Press Esc anytime to stop' })}
          >
            <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>{t('claudeStatus.controls.stopGeneration', { defaultValue: 'Stop' })}</span>
          </button>
        )}
      </div>
    </div>
  );
}
