import { useCallback, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useTheme } from '../../../contexts/ThemeContext';
import { useQuickSettingsDrag } from '../hooks/useQuickSettingsDrag';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '../types';
import QuickSettingsContent from './QuickSettingsContent';
import QuickSettingsHandle from './QuickSettingsHandle';
import QuickSettingsPanelHeader from './QuickSettingsPanelHeader';

export default function QuickSettingsPanelView() {
  const [isOpen, setIsOpen] = useState(false);
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { isDarkMode } = useTheme();
  const { preferences, setPreference } = useUiPreferences();
  const {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

  const quickSettingsPreferences = useMemo<QuickSettingsPreferences>(() => ({
    autoExpandTools: preferences.autoExpandTools,
    showRawParameters: preferences.showRawParameters,
    showThinking: preferences.showThinking,
    autoScrollToBottom: preferences.autoScrollToBottom,
    sendByCtrlEnter: preferences.sendByCtrlEnter,
  }), [
    preferences.autoExpandTools,
    preferences.autoScrollToBottom,
    preferences.sendByCtrlEnter,
    preferences.showRawParameters,
    preferences.showThinking,
  ]);

  const handlePreferenceChange = useCallback(
    (key: PreferenceToggleKey, value: boolean) => {
      setPreference(key, value);
    },
    [setPreference],
  );

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // A drag releases a click event as well; this guard prevents accidental toggles.
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }

      setIsOpen((previous) => !previous);
    },
    [consumeSuppressedClick],
  );

  return (
    <>
      <QuickSettingsHandle
        isOpen={isOpen}
        isDragging={isDragging}
        style={handleStyle}
        onClick={handleToggleFromHandle}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />

      {/*
        z-index 정리:
        - MainContentHeader 탭 클러스터(chat/shell/files/git) 가 z-[1001] 이라
          패널이 z-40 이면 탭이 패널 위에 떠서 헤더를 가린다.
        - 패널 z-[1100], backdrop z-[1090] 으로 잡아서 패널이 열렸을 때
          탭/드래그 영역 모두 패널 아래에 깔리도록 한다.
        - `vienna-main-content` 클래스를 부여해 Vienna 의 글로벌 zoom
          (`Cmd+= / Cmd+-`) 이 패널에도 적용되어 폰트 사이즈가 컨텐츠
          영역과 통일되게 한다.
      */}
      <div
        className={`vienna-main-content fixed right-0 top-0 z-[1100] h-full w-64 transform border-l border-border bg-background shadow-xl transition-transform duration-150 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} ${isMobile ? 'h-screen' : ''}`}
      >
        <div className="flex h-full flex-col">
          <QuickSettingsPanelHeader />
          <QuickSettingsContent
            isDarkMode={isDarkMode}
            isMobile={isMobile}
            preferences={quickSettingsPreferences}
            onPreferenceChange={handlePreferenceChange}
          />
        </div>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[1090] bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
