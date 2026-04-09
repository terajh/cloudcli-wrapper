import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';

/**
 * Hex 색상 입력 필드 — native color picker + hex 텍스트 입력 동기화.
 * 사용자는 둘 중 어느 쪽을 조작해도 다른 쪽이 갱신된다.
 */
function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  const commitText = (raw: string) => {
    const trimmed = raw.trim();
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (/^#[0-9a-fA-F]{6}$/.test(withHash) || /^#[0-9a-fA-F]{3}$/.test(withHash)) {
      onChange(withHash);
    } else {
      // 잘못된 입력 — 마지막 valid 값으로 되돌림
      setText(value);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <label
        className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="색상 선택"
        />
      </label>
      <input
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commitText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            (event.target as HTMLInputElement).blur();
          }
        }}
        spellCheck={false}
        className="w-28 rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm uppercase text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
import { DarkModeToggle } from '../../../../shared/view/ui';
import type { CodeEditorSettingsState, ProjectSortOrder } from '../../types/types';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';
import type { DesignTokens } from '../../../../hooks/useDesignTokens';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorThemeChange: (value: 'dark' | 'light') => void;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
  designTokens: DesignTokens;
  onDesignTokenChange: <K extends keyof DesignTokens>(key: K, value: DesignTokens[K]) => void;
  onResetDesignTokens: () => void;
};

export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorThemeChange,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
  designTokens,
  onDesignTokenChange,
  onResetDesignTokens,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');

  // 색 입력은 hex 형식. ColorField 가 자체 검증 후 normalized 값을 넘겨준다.
  const handleColorInput = (key: 'background', raw: string) => {
    onDesignTokenChange(key, raw);
  };

  return (
    <div className="space-y-8">
      <SettingsSection title="디자인 시스템">
        <SettingsCard divided>
          <SettingsRow
            label="Background"
            description="컨텐츠 영역의 베이스 색. 사이드바는 이 색에서 자동으로 살짝 밝게 파생됩니다."
          >
            <ColorField
              value={designTokens.background}
              onChange={(value) => handleColorInput('background', value)}
            />
          </SettingsRow>

          <SettingsRow
            label="UI font"
            description="앱 전반에 사용되는 UI 폰트 패밀리. CSS font-family 형식."
          >
            <input
              type="text"
              value={designTokens.uiFont}
              onChange={(event) => onDesignTokenChange('uiFont', event.target.value)}
              spellCheck={false}
              className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:w-72"
            />
          </SettingsRow>

          <SettingsRow
            label="Code font"
            description="코드 블록과 모노스페이스 영역에 사용되는 폰트."
          >
            <input
              type="text"
              value={designTokens.codeFont}
              onChange={(event) => onDesignTokenChange('codeFont', event.target.value)}
              spellCheck={false}
              className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:w-72"
            />
          </SettingsRow>

          <SettingsRow
            label="기본값으로 초기화"
            description="모든 디자인 토큰을 Vienna 기본값으로 되돌립니다."
          >
            <button
              type="button"
              onClick={onResetDesignTokens}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent/40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              초기화
            </button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.darkMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.darkMode.label')}
            description={t('appearanceSettings.darkMode.description')}
          >
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.codeEditor.theme.label')}
            description={t('appearanceSettings.codeEditor.theme.description')}
          >
            <DarkModeToggle
              checked={codeEditorSettings.theme === 'dark'}
              onToggle={(enabled) => onCodeEditorThemeChange(enabled ? 'dark' : 'light')}
              ariaLabel={t('appearanceSettings.codeEditor.theme.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.wordWrap.label')}
            description={t('appearanceSettings.codeEditor.wordWrap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.wordWrap}
              onChange={onCodeEditorWordWrapChange}
              ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.showMinimap.label')}
            description={t('appearanceSettings.codeEditor.showMinimap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.showMinimap}
              onChange={onCodeEditorShowMinimapChange}
              ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.lineNumbers.label')}
            description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.lineNumbers}
              onChange={onCodeEditorLineNumbersChange}
              ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.fontSize.label')}
            description={t('appearanceSettings.codeEditor.fontSize.description')}
          >
            <select
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
            >
              <option value="10">10px</option>
              <option value="11">11px</option>
              <option value="12">12px</option>
              <option value="13">13px</option>
              <option value="14">14px</option>
              <option value="15">15px</option>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
