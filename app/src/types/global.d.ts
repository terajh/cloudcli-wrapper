export {};

declare global {
  interface Window {
    __ROUTER_BASENAME__?: string;
    refreshProjects?: () => void | Promise<void>;
    injectOptimisticSession?: (
      projectName: string,
      sessionMeta: { id: string; summary?: string; lastActivity?: string },
      provider?: string,
    ) => void;
    promoteOptimisticSession?: (tempId: string, realId: string) => boolean;
    sweepStaleOptimisticTempIds?: (projectName: string) => void;
    openSettings?: (tab?: string) => void;
  }

  interface EventSourceEventMap {
    result: MessageEvent;
    progress: MessageEvent;
    done: MessageEvent;
  }
}
