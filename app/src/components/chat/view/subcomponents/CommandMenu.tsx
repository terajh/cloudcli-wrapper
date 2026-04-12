import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

type CommandMenuCommand = {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  agent?: string;
  scope?: string;
  kind?: string;
  metadata?: { type?: string; [key: string]: unknown };
  [key: string]: unknown;
};

type CommandMenuProps = {
  commands?: CommandMenuCommand[];
  selectedIndex?: number;
  onSelect?: (command: CommandMenuCommand, index: number, isHover: boolean) => void;
  onClose: () => void;
  position?: { top: number; left: number; bottom?: number };
  isOpen?: boolean;
  frequentCommands?: CommandMenuCommand[];
};

const menuBaseStyle: CSSProperties = {
  maxHeight: '300px',
  overflowY: 'hidden',
  borderRadius: '10px',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.06)',
  zIndex: 1000,
  padding: '6px',
  paddingBottom: '0',
  transition: 'opacity 150ms ease-in-out, transform 150ms ease-in-out',
};

const namespaceLabels: Record<string, string> = {
  frequent: 'Frequently Used',
  builtin: 'Built-in Commands',
  project: 'Project Commands',
  user: 'User Commands',
  'skill:claude': 'Claude Skills',
  'skill:codex': 'Codex Skills',
  other: 'Other Commands',
};

function getAgentBadgeStyle(agent?: string): string {
  if (agent === 'claude') {
    return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
  }
  if (agent === 'codex') {
    return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  }
  return 'bg-gray-500/15 text-gray-400 border-gray-500/30';
}

const getCommandKey = (command: CommandMenuCommand) =>
  `${command.name}::${command.namespace || command.type || 'other'}::${command.path || ''}`;

const getNamespace = (command: CommandMenuCommand) => command.namespace || command.type || 'other';

const getMenuPosition = (position: { top: number; left: number; bottom?: number }): CSSProperties => {
  if (typeof window === 'undefined') {
    return { position: 'fixed', top: '16px', left: '16px' };
  }
  if (window.innerWidth < 640) {
    return {
      position: 'fixed',
      bottom: `${position.bottom ?? 90}px`,
      left: '16px',
      right: '16px',
      width: 'auto',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'min(50vh, 300px)',
    };
  }
  return {
    position: 'fixed',
    top: `${Math.max(16, Math.min(position.top, window.innerHeight - 316))}px`,
    left: `${position.left}px`,
    width: 'min(420px, calc(100vw - 32px))',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: '300px',
  };
};

export default function CommandMenu({
  commands = [],
  selectedIndex = -1,
  onSelect,
  onClose,
  position = { top: 0, left: 0 },
  isOpen = false,
  frequentCommands = [],
}: CommandMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  const menuPosition = getMenuPosition(position);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current || !(event.target instanceof Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!selectedItemRef.current || !menuRef.current) {
      return;
    }
    const menuRect = menuRef.current.getBoundingClientRect();
    const itemRect = selectedItemRef.current.getBoundingClientRect();
    if (itemRect.bottom > menuRect.bottom || itemRect.top < menuRect.top) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  if (!isOpen) {
    return null;
  }

  const hasFrequentCommands = frequentCommands.length > 0;
  const frequentCommandKeys = new Set(frequentCommands.map(getCommandKey));
  const groupedCommands = commands.reduce<Record<string, CommandMenuCommand[]>>((groups, command) => {
    if (hasFrequentCommands && frequentCommandKeys.has(getCommandKey(command))) {
      return groups;
    }
    const namespace = getNamespace(command);
    if (!groups[namespace]) {
      groups[namespace] = [];
    }
    groups[namespace].push(command);
    return groups;
  }, {});
  if (hasFrequentCommands) {
    groupedCommands.frequent = frequentCommands;
  }

  const preferredOrder = hasFrequentCommands
    ? ['frequent', 'builtin', 'project', 'user', 'skill:claude', 'skill:codex', 'other']
    : ['builtin', 'project', 'user', 'skill:claude', 'skill:codex', 'other'];
  const extraNamespaces = Object.keys(groupedCommands).filter((namespace) => !preferredOrder.includes(namespace));
  const orderedNamespaces = [...preferredOrder, ...extraNamespaces].filter((namespace) => groupedCommands[namespace]);

  const commandIndexByKey = new Map<string, number>();
  commands.forEach((command, index) => {
    const key = getCommandKey(command);
    if (!commandIndexByKey.has(key)) {
      commandIndexByKey.set(key, index);
    }
  });

  if (commands.length === 0) {
    return (
      <div
        ref={menuRef}
        className="command-menu command-menu-empty border border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
        style={{ ...menuPosition, ...menuBaseStyle, overflowY: 'hidden', padding: '20px', opacity: 1, transform: 'translateY(0)', textAlign: 'center' }}
      >
        No commands available
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Available commands"
      className="command-menu border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
      style={{ ...menuPosition, ...menuBaseStyle, opacity: 1, transform: 'translateY(0)' }}
    >
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(300px - 36px)' }}>
      {orderedNamespaces.map((namespace, groupIndex) => (
        <div key={namespace} className={`command-group ${groupIndex > 0 ? 'mt-1 border-t border-gray-100 pt-1 dark:border-gray-700/50' : ''}`}>
          {orderedNamespaces.length > 1 && (
            <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {namespaceLabels[namespace] || namespace}
            </div>
          )}

          {(groupedCommands[namespace] || []).map((command) => {
            const commandKey = getCommandKey(command);
            const commandIndex = commandIndexByKey.get(commandKey) ?? -1;
            const isSelected = commandIndex === selectedIndex;
            return (
              <div
                key={`${namespace}-${command.name}-${command.path || ''}`}
                ref={isSelected ? selectedItemRef : null}
                role="option"
                aria-selected={isSelected}
                className={`command-item mb-0.5 flex cursor-pointer items-center rounded-md border-l-2 px-3 py-2 transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/40'
                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/40'
                }`}
                onMouseEnter={() => onSelect && commandIndex >= 0 && onSelect(command, commandIndex, true)}
                onClick={() => onSelect && commandIndex >= 0 && onSelect(command, commandIndex, false)}
                onMouseDown={(event) => event.preventDefault()}
              >
                <div className="min-w-0 flex-1">
                  <div className={`flex items-center gap-2 ${command.description ? 'mb-0.5' : 'mb-0'}`}>
                    <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100" style={{ fontFamily: 'var(--font-ui)' }}>{command.name}</span>
                    {command.kind === 'skill' && command.agent && (
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${getAgentBadgeStyle(command.agent)}`}
                        title={`${command.agent} skill (${command.scope || 'user'})`}
                      >
                        {command.agent}
                      </span>
                    )}
                    {command.kind === 'skill' && command.scope && command.scope !== 'user' && (
                      <span className="shrink-0 rounded bg-gray-200/60 px-1 py-0.5 text-[9px] uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                        {command.scope}
                      </span>
                    )}
                    {command.kind !== 'skill' && command.metadata?.type && (
                      <span className="command-metadata-badge rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                        {command.metadata.type}
                      </span>
                    )}
                  </div>
                  {command.description && (
                    <div className="truncate whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                      {command.description}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <svg className="ml-2 h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      ))}
      </div>
      <div className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400 dark:border-gray-700/50 dark:text-gray-500">
        <span className="inline-flex items-center gap-3">
          <span><kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-gray-700">↑↓</kbd> navigate</span>
          <span><kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-gray-700">Enter</kbd> select</span>
          <span><kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-gray-700">Esc</kbd> close</span>
        </span>
      </div>
    </div>
  );
}
