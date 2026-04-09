import type React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import MarkdownPreview from './markdown/MarkdownPreview';

type CodeEditorSurfaceProps = {
  content: string;
  onChange: (value: string) => void;
  markdownPreview: boolean;
  isMarkdownFile: boolean;
  isDarkMode: boolean;
  fontSize: number;
  showLineNumbers: boolean;
  extensions: Extension[];
};

export default function CodeEditorSurface({
  content,
  onChange,
  markdownPreview,
  isMarkdownFile,
  isDarkMode,
  fontSize,
  showLineNumbers,
  extensions,
}: CodeEditorSurfaceProps) {
  if (markdownPreview && isMarkdownFile) {
    return (
      <div className="h-full overflow-y-auto bg-white dark:bg-gray-900">
        <div className="prose prose-sm mx-auto max-w-4xl max-w-none px-8 py-6 dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 prose-code:text-sm prose-pre:bg-gray-900 prose-img:rounded-lg dark:prose-a:text-blue-400">
          <MarkdownPreview content={content} />
        </div>
      </div>
    );
  }

  // index.css 의 글로벌 `!important` 폰트 잠금이 `--cm-fs` 변수를 사용한다.
  // 사용자 설정 fontSize 를 wrapper 의 inline CSS 변수로 주입해, CodeMirror
  // 내부 element 들이 모두 동일한 사이즈로 그려지도록 한다.
  return (
    <div
      className="h-full w-full"
      style={{ ['--cm-fs' as string]: `${fontSize}px` } as React.CSSProperties}
    >
      <CodeMirror
        value={content}
        onChange={onChange}
        extensions={extensions}
        theme={isDarkMode ? oneDark : undefined}
        height="100%"
        style={{ height: '100%' }}
        basicSetup={{
          lineNumbers: showLineNumbers,
          foldGutter: true,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
      />
    </div>
  );
}
