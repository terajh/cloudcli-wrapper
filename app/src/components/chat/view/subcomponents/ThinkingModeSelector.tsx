import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { thinkingModes } from '../../constants/thinkingModes';

type ThinkingModeSelectorProps = {
  selectedMode: string;
  onModeChange: (modeId: string) => void;
  onClose?: () => void;
  className?: string;
};

function ThinkingModeSelector({ selectedMode, onModeChange, onClose, className = '' }: ThinkingModeSelectorProps) {
  const { t } = useTranslation('chat');

  // Mapping from mode ID to translation key
  const modeKeyMap: Record<string, string> = {
    'think-hard': 'thinkHard',
    'think-harder': 'thinkHarder'
  };
  // Create translated modes for display
  const translatedModes = thinkingModes.map(mode => {
    const modeKey = modeKeyMap[mode.id] || mode.id;
    return {
      ...mode,
      name: t(`thinkingMode.modes.${modeKey}.name`),
      description: t(`thinkingMode.modes.${modeKey}.description`),
      prefix: t(`thinkingMode.modes.${modeKey}.prefix`)
    };
  });

  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
        if (onClose) onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // 버튼 위치 기준으로 dropdown 좌표 계산 (overflow-hidden 부모를 escape)
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 256; // w-64
    const padding = 8;
    const left = Math.max(padding, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - padding));
    const bottom = window.innerHeight - rect.top + 6;
    setMenuPos({ left, bottom });
  }, [isOpen]);

  const currentMode = translatedModes.find(mode => mode.id === selectedMode) || translatedModes[0];
  const IconComponent = currentMode.icon || Brain;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-all duration-200 ${
          selectedMode === 'none'
            ? 'bg-white/5 hover:bg-white/10'
            : 'bg-blue-500/20 hover:bg-blue-500/30'
        }`}
        title={t('thinkingMode.buttonTitle', { mode: currentMode.name })}
      >
        <IconComponent
          className={`h-3.5 w-3.5 ${
            selectedMode === 'none' ? 'text-muted-foreground' : currentMode.color
          }`}
        />
      </button>

      {isOpen && menuPos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[1000] w-64 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
          style={{ left: `${menuPos.left}px`, bottom: `${menuPos.bottom}px`, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}
        >
          <div className="border-b border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('thinkingMode.selector.title')}
              </h3>
              <button
                onClick={() => {
                  setIsOpen(false);
                  if (onClose) onClose();
                }}
                className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('thinkingMode.selector.description')}
            </p>
          </div>

          <div className="py-1">
            {translatedModes.map((mode) => {
              const ModeIcon = mode.icon;
              const isSelected = mode.id === selectedMode;

              return (
                <button
                  key={mode.id}
                  onClick={() => {
                    onModeChange(mode.id);
                    setIsOpen(false);
                    if (onClose) onClose();
                  }}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${isSelected ? 'bg-gray-50 dark:bg-gray-700' : ''
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${mode.icon ? mode.color : 'text-gray-400'}`}>
                      {ModeIcon ? <ModeIcon className="h-5 w-5" /> : <div className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                          }`}>
                          {mode.name}
                        </span>
                        {isSelected && (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                            {t('thinkingMode.selector.active')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {mode.description}
                      </p>
                      {mode.prefix && (
                        <code className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">
                          {mode.prefix}
                        </code>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              <strong>Tip:</strong> {t('thinkingMode.selector.tip')}
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default ThinkingModeSelector;