import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Project } from '../../../../types/app';

const VISIBLE_PROJECTS_KEY = 'vienna_visible_projects';
const VISIBLE_PROJECTS_LEGACY_KEY = 'caui_visible_projects';

export function getVisibleProjects(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    let raw = window.localStorage.getItem(VISIBLE_PROJECTS_KEY);
    // legacy 키에서 1회성 마이그레이션
    if (!raw) {
      const legacy = window.localStorage.getItem(VISIBLE_PROJECTS_LEGACY_KEY);
      if (legacy) {
        raw = legacy;
        window.localStorage.setItem(VISIBLE_PROJECTS_KEY, legacy);
        window.localStorage.removeItem(VISIBLE_PROJECTS_LEGACY_KEY);
      }
    }
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function saveVisibleProjects(visible: Set<string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VISIBLE_PROJECTS_KEY, JSON.stringify(Array.from(visible)));
}

type Props = {
  projects: Project[];
  open: boolean;
  onClose: () => void;
  onSave: (visible: Set<string>) => void;
  t: TFunction;
};

export default function SidebarProjectFilterModal({ projects, open, onClose, onSave }: Props) {
  const [visible, setVisible] = useState<Set<string>>(() => getVisibleProjects());

  useEffect(() => {
    if (open) setVisible(getVisibleProjects());
  }, [open]);

  if (!open) return null;

  const toggleProject = (name: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleSave = () => {
    saveVisibleProjects(visible);
    onSave(visible);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">프로젝트 표시 설정</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <p className="mb-3 px-1 text-xs text-muted-foreground">
            체크된 프로젝트만 사이드바에 표시됩니다. (기본값: 아무 것도 표시 안 됨)
          </p>
          <div className="space-y-1">
            {projects.map((p) => {
              const isVisible = visible.has(p.name);
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => toggleProject(p.name)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <div
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                      isVisible ? 'border-blue-500 bg-blue-500' : 'border-border'
                    }`}
                  >
                    {isVisible && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <span className="truncate text-sm text-foreground">{p.displayName}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted">
            취소
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-white/15"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
