import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { useDesignTokens } from '../../hooks/useDesignTokens';
import MobileNav from './MobileNav';

// 사이드바 접힘 애니메이션 스펙
// - 펼침 너비: localStorage `vienna_sidebar_width` 에 저장된 값 (기본 280)
// - 접힘 너비: 78px — macOS 신호등 버튼(red/yellow/green) 우측 끝에 딱 맞게 정렬
const COLLAPSED_SIDEBAR_WIDTH = 78;
const SIDEBAR_WIDTH_STORAGE_KEY = 'vienna_sidebar_width';
const SIDEBAR_WIDTH_LEGACY_KEY = 'caui_sidebar_width';
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 480;

const readSavedSidebarWidth = (): number => {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
  const saved =
    window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ||
    window.localStorage.getItem(SIDEBAR_WIDTH_LEGACY_KEY);
  const parsed = saved ? parseInt(saved, 10) : DEFAULT_SIDEBAR_WIDTH;
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, parsed));
};

export default function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const { preferences } = useUiPreferences();
  // 사용자가 설정에서 background 색을 바꾸면 즉시 wide 컨텐츠 영역이
  // 따라오도록, hex 값을 직접 인라인 스타일로 박는다.
  // useDesignTokens 의 broadcast 이벤트로 다른 인스턴스가 동기화되어
  // React 가 AppContent 를 새 hex 로 다시 렌더한다.
  const { tokens: designTokens } = useDesignTokens();
  const wasConnectedRef = useRef(false);

  // 사이드바 접힘 상태와 펼침 너비를 AppContent 가 소유한다.
  // - SidebarContent 의 resize 핸들이 너비를 바꾸면 'vienna-sidebar-width-changed'
  //   custom event 로 통지받아 동기화한다.
  // - wrapper 자체에 transition-[width] 를 걸어 접힘/펼침이 부드럽게 동작.
  const [savedSidebarWidth, setSavedSidebarWidth] = useState<number>(() => readSavedSidebarWidth());
  const isSidebarCollapsed = !isMobile && preferences.sidebarVisible === false;
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ width: number }>).detail;
      if (detail && Number.isFinite(detail.width)) {
        setSavedSidebarWidth(
          Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, detail.width)),
        );
      }
    };
    window.addEventListener('vienna-sidebar-width-changed', handler as EventListener);
    return () => window.removeEventListener('vienna-sidebar-width-changed', handler as EventListener);
  }, []);

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isInputFocused,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    refreshProjectsSilently,
    injectOptimisticSession,
    promoteOptimisticSession,
    sweepStaleOptimisticTempIds,
    sidebarSharedProps,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
  });

  useEffect(() => {
    // Expose a non-blocking refresh for chat/session flows.
    // Full loading refreshes are still available through direct fetchProjects calls.
    window.refreshProjects = refreshProjectsSilently;

    return () => {
      if (window.refreshProjects === refreshProjectsSilently) {
        delete window.refreshProjects;
      }
    };
  }, [refreshProjectsSilently]);

  useEffect(() => {
    window.injectOptimisticSession = injectOptimisticSession;
    return () => {
      if (window.injectOptimisticSession === injectOptimisticSession) {
        delete window.injectOptimisticSession;
      }
    };
  }, [injectOptimisticSession]);

  useEffect(() => {
    window.promoteOptimisticSession = promoteOptimisticSession;
    return () => {
      if (window.promoteOptimisticSession === promoteOptimisticSession) {
        delete window.promoteOptimisticSession;
      }
    };
  }, [promoteOptimisticSession]);

  useEffect(() => {
    window.sweepStaleOptimisticTempIds = sweepStaleOptimisticTempIds;
    return () => {
      if (window.sweepStaleOptimisticTempIds === sweepStaleOptimisticTempIds) {
        delete window.sweepStaleOptimisticTempIds;
      }
    };
  }, [sweepStaleOptimisticTempIds]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  // Sidebar zoom: mirror __vienna_apply_zoom__ to .vienna-sidebar so that
  // Cmd+= / Cmd+- / Cmd+0 also scales the sidebar font size.
  useEffect(() => {
    const applySidebarZoom = () => {
      const zoom = (window as Record<string, unknown>).__vienna_zoom_state__ as { current?: number } | undefined;
      const level = zoom?.current ?? 1;
      const el = document.querySelector('.vienna-sidebar') as HTMLElement | null;
      if (el) {
        el.style.zoom = String(level);
      }
    };

    const wrap = () => {
      const w = window as Record<string, unknown>;
      if (typeof w.__vienna_apply_zoom__ !== 'function') return false;
      if ((w.__vienna_apply_zoom__ as { __sidebar_patched__?: boolean }).__sidebar_patched__) {
        applySidebarZoom();
        return true;
      }
      const original = w.__vienna_apply_zoom__ as (direction: string) => void;
      const patched = (direction: string) => {
        original(direction);
        applySidebarZoom();
      };
      (patched as { __sidebar_patched__?: boolean }).__sidebar_patched__ = true;
      w.__vienna_apply_zoom__ = patched;
      applySidebarZoom();
      return true;
    };

    if (!wrap()) {
      const interval = setInterval(() => {
        if (wrap()) clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        localStorage.setItem('selected-provider', message.provider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  // Permission recovery: query pending permissions on WebSocket reconnect or session change
  useEffect(() => {
    const isReconnect = isConnected && !wasConnectedRef.current;

    if (isReconnect) {
      wasConnectedRef.current = true;
    } else if (!isConnected) {
      wasConnectedRef.current = false;
    }

    if (isConnected && selectedSession?.id) {
      sendMessage({
        type: 'get-pending-permissions',
        sessionId: selectedSession.id
      });
    }
  }, [isConnected, selectedSession?.id, sendMessage]);

  return (
    <div
      // 컨텐츠 영역(사이드바 우측 wide 배경) 은 사용자 background hex 를
      // 직접 인라인으로 적용해 React 가 토큰 변화 시 즉시 다시 페인트하도록 한다.
      className="fixed inset-0 flex"
      style={{ backgroundColor: designTokens.background }}
    >
      {/*
        Vienna(Tauri) — macOS title bar drag region.
        - tauri.conf.json 의 windows[0].titleBarStyle = "Overlay" + hiddenTitle
          상태에서는 OS 가 신호등 버튼만 그리고 나머지 상단 영역은 webview 가
          그대로 차지한다. webview 영역은 기본적으로 non-draggable 이므로
          명시적인 drag region 을 박아 두지 않으면 사용자가 상단을 잡고 창을
          옮기지 못한다.
        - data-tauri-drag-region 속성을 가진 div 는 mousedown -> 윈도우 이동,
          더블클릭 -> macOS '윈도우 더블클릭 동작' 설정(기본: zoom)을 그대로
          위임받는다. 그래서 본 div 하나로 "최상단 영역 드래그" + "더블클릭 zoom"
          이 동시에 처리된다.
        - 신호등 버튼 영역(좌측 ~78px)은 padding 으로 비워 OS 에 클릭 이벤트가
          가도록 한다. 높이 28px 는 macOS 기본 title bar 와 동일.
        - 데스크톱(웹 브라우저)에서 동작했을 때는 단순한 투명 띠라서 어떤 것도
          가리지 않는다.
      */}
      <div
        data-tauri-drag-region
        className="fixed inset-x-0 top-0 z-[1000] h-7 select-none"
        style={{ paddingLeft: 78 }}
        aria-hidden="true"
      />
      {!isMobile ? (
        <div
          className="vienna-sidebar h-full flex-shrink-0 overflow-hidden border-r border-border/50 transition-[width] duration-300 ease-in-out"
          style={{ width: `${isSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : savedSidebarWidth}px` }}
        >
          <Sidebar {...sidebarSharedProps} />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
        </div>
      )}

      <div className={`flex min-w-0 flex-1 flex-col ${isMobile ? 'pb-mobile-nav' : ''}`}>
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          latestMessage={latestMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionActive={markSessionAsActive}
          onSessionInactive={markSessionAsInactive}
          onSessionProcessing={markSessionAsProcessing}
          onSessionNotProcessing={markSessionAsNotProcessing}
          processingSessions={processingSessions}
          onReplaceTemporarySession={replaceTemporarySession}
          onNavigateToSession={(targetSessionId: string) => navigate(`/session/${targetSessionId}`)}
          onShowSettings={() => setShowSettings(true)}
          externalMessageUpdate={externalMessageUpdate}
        />
      </div>

      {isMobile && (
        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
        />
      )}

    </div>
  );
}
