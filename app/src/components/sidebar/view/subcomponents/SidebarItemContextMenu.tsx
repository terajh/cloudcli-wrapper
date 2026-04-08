import { useEffect, useRef } from 'react';
import { Edit3, Star, StarOff, Trash2 } from 'lucide-react';

export type ContextMenuItem = {
  id: 'favorite' | 'edit' | 'delete';
  label: string;
  icon: 'star' | 'star-off' | 'edit' | 'trash';
  onClick: () => void;
  variant?: 'default' | 'destructive';
};

type SidebarItemContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

const ICON_MAP = {
  star: Star,
  'star-off': StarOff,
  edit: Edit3,
  trash: Trash2,
} as const;

export default function SidebarItemContextMenu({ x, y, items, onClose }: SidebarItemContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // 메뉴가 열린 즉시 발생하는 클릭에 의해 닫히지 않도록 next tick에 등록
    const timeoutId = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('contextmenu', handleClickOutside);
    }, 0);

    document.addEventListener('keydown', handleEscape);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // 화면 밖으로 벗어나지 않도록 위치 조정
  const adjustedStyle = (() => {
    const menuWidth = 180;
    const menuHeight = items.length * 36 + 8;
    const padding = 8;
    const maxX = window.innerWidth - menuWidth - padding;
    const maxY = window.innerHeight - menuHeight - padding;
    return {
      left: Math.min(x, Math.max(padding, maxX)),
      top: Math.min(y, Math.max(padding, maxY)),
    };
  })();

  return (
    <div
      ref={menuRef}
      className="fixed z-[1000] min-w-[180px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-2xl"
      style={adjustedStyle}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      {items.map((item) => {
        const Icon = ICON_MAP[item.icon];
        const isDestructive = item.variant === 'destructive' || item.id === 'delete';
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
              isDestructive
                ? 'text-red-500 hover:bg-red-500/10'
                : 'text-foreground hover:bg-muted/60'
            }`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            <Icon className={`h-3.5 w-3.5 ${isDestructive ? 'text-red-500' : 'text-muted-foreground'}`} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
