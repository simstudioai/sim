'use client'

import { useSyncExternalStore } from 'react'
import type { editor as MonacoEditorTypes } from 'monaco-editor'
import dynamic from 'next/dynamic'

/**
 * The Monaco editor as the workspace configures it: lazily loaded with its language workers and
 * the Sim light and dark themes, plus the shared text-editor options. Used by the file viewer's
 * text editor and the workflow Code tab.
 */

export const TEXT_EDITOR_OPTIONS = {
  largeFileOptimizations: true,
  maxTokenizationLineLength: 20_000,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  fontSize: 13,
  lineNumbers: 'on',
  padding: { top: 24, bottom: 24 },
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  tabSize: 2,
  automaticLayout: true,
  renderLineHighlight: 'line',
  occurrencesHighlight: 'singleFile',
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 6,
    horizontalScrollbarSize: 6,
  },
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: 'currentDocument',
  parameterHints: { enabled: false },
  codeLens: false,
  lightbulb: {
    enabled: 'off' as MonacoEditorTypes.ShowLightbulbIconMode,
  },
  inlayHints: { enabled: 'off' },
  contextmenu: false,
  fixedOverflowWidgets: true,
  glyphMargin: false,
  stickyScroll: { enabled: false },
  bracketPairColorization: { enabled: false },
  unicodeHighlight: { ambiguousCharacters: false },
} satisfies MonacoEditorTypes.IStandaloneEditorConstructionOptions

const SIM_DARK_RULES: MonacoEditorTypes.ITokenThemeRule[] = [
  { token: 'comment', foreground: '606060', fontStyle: 'italic' },
  { token: 'string', foreground: '3ab872' },
  { token: 'string.escape', foreground: '3ab872' },
  { token: 'string.link', foreground: '33b4ff' },
  { token: 'number', foreground: 'e8a87c' },
  { token: 'number.float', foreground: 'e8a87c' },
  { token: 'number.hex', foreground: 'e8a87c' },
  { token: 'keyword', foreground: '33b4ff' },
  { token: 'keyword.control', foreground: '33b4ff' },
  { token: 'storage', foreground: '33b4ff' },
  { token: 'type', foreground: '8fc7f5' },
  { token: 'type.identifier', foreground: '8fc7f5' },
  { token: 'regexp', foreground: 'ff8a65' },
  { token: 'annotation', foreground: 'ffca28' },
  { token: 'delimiter', foreground: '555555' },
  { token: 'tag', foreground: '33b4ff' },
  { token: 'attribute.name', foreground: '8fc7f5' },
  { token: 'attribute.value', foreground: '3ab872' },
  { token: 'strong', foreground: 'e6e6e6', fontStyle: 'bold' },
  { token: 'emphasis', foreground: 'c8c8c8', fontStyle: 'italic' },
  { token: 'variable', foreground: '3ab872' },
  { token: 'variable.source', foreground: 'b0b0b0' },
  { token: 'meta.separator', foreground: '404040' },
]

const SIM_LIGHT_RULES: MonacoEditorTypes.ITokenThemeRule[] = [
  { token: 'comment', foreground: '888888', fontStyle: 'italic' },
  { token: 'string', foreground: '16825d' },
  { token: 'string.escape', foreground: '16825d' },
  { token: 'string.link', foreground: '0078d4' },
  { token: 'number', foreground: 'a85500' },
  { token: 'number.float', foreground: 'a85500' },
  { token: 'number.hex', foreground: 'a85500' },
  { token: 'keyword', foreground: '0078d4' },
  { token: 'keyword.control', foreground: '0078d4' },
  { token: 'storage', foreground: '0078d4' },
  { token: 'type', foreground: '7c4dcc' },
  { token: 'type.identifier', foreground: '7c4dcc' },
  { token: 'regexp', foreground: 'd7390c' },
  { token: 'annotation', foreground: 'e67700' },
  { token: 'delimiter', foreground: 'aaaaaa' },
  { token: 'tag', foreground: '0078d4' },
  { token: 'attribute.name', foreground: '7c4dcc' },
  { token: 'attribute.value', foreground: '16825d' },
  { token: 'strong', foreground: '1a1a1a', fontStyle: 'bold' },
  { token: 'emphasis', foreground: '444444', fontStyle: 'italic' },
  { token: 'variable', foreground: '16825d' },
  { token: 'variable.source', foreground: '555555' },
  { token: 'meta.separator', foreground: 'cccccc' },
]

export const MonacoEditor = dynamic(
  async () => {
    const [{ default: Editor, loader }, monaco] = await Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor'),
    ])

    if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
      window.MonacoEnvironment = {
        getWorker(_: string, label: string) {
          if (label === 'json') {
            return new Worker(
              new URL('monaco-editor/languages/features/json/json.worker', import.meta.url)
            )
          }
          if (label === 'css' || label === 'scss' || label === 'less') {
            return new Worker(
              new URL('monaco-editor/languages/features/css/css.worker', import.meta.url)
            )
          }
          if (label === 'html' || label === 'handlebars' || label === 'razor') {
            return new Worker(
              new URL('monaco-editor/languages/features/html/html.worker', import.meta.url)
            )
          }
          if (label === 'typescript' || label === 'javascript') {
            return new Worker(
              new URL('monaco-editor/languages/features/typescript/ts.worker', import.meta.url)
            )
          }
          return new Worker(new URL('monaco-editor/editor/editor.worker', import.meta.url))
        },
      }
    }

    loader.config({ monaco })

    monaco.editor.defineTheme('sim-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: SIM_DARK_RULES,
      colors: {
        'editor.background': '#1b1b1b',
        'editor.foreground': '#e6e6e6',
        'editorLineNumber.foreground': '#404040',
        'editorLineNumber.activeForeground': '#787878',
        'editor.selectionBackground': '#33b4ff28',
        'editor.inactiveSelectionBackground': '#33b4ff14',
        'editor.lineHighlightBackground': '#23232380',
        'editor.lineHighlightBorder': '#00000000',
        'editorGutter.background': '#1b1b1b',
        'editorWidget.background': '#242424',
        'editorWidget.border': '#333333',
        'editorWidget.foreground': '#e6e6e6',
        'editor.findMatchBackground': '#33b4ff40',
        'editor.findMatchHighlightBackground': '#33b4ff1a',
        'editor.findMatchBorder': '#33b4ff',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#33333380',
        'scrollbarSlider.hoverBackground': '#45454580',
        'scrollbarSlider.activeBackground': '#505050',
        'editorBracketMatch.background': '#33b4ff1a',
        'editorBracketMatch.border': '#33b4ff80',
        'editorIndentGuide.background1': '#2a2a2a',
        'editorIndentGuide.activeBackground1': '#454545',
        'editorCursor.foreground': '#e6e6e6',
        'editor.wordHighlightBackground': '#33b4ff14',
        'editor.wordHighlightBorder': '#33b4ff40',
        'editorSuggestWidget.background': '#242424',
        'editorSuggestWidget.border': '#333333',
        'editorSuggestWidget.foreground': '#e6e6e6',
        'editorSuggestWidget.selectedBackground': '#292929',
        'editorSuggestWidget.selectedForeground': '#e6e6e6',
        'editorHoverWidget.background': '#242424',
        'editorHoverWidget.border': '#333333',
        'editorHoverWidget.foreground': '#e6e6e6',
        'minimap.background': '#1b1b1b',
        'minimapSlider.background': '#33333380',
        focusBorder: '#33b4ff80',
        'input.background': '#242424',
        'input.border': '#333333',
        'input.foreground': '#e6e6e6',
        'inputOption.activeBorder': '#33b4ff',
      },
    })

    monaco.editor.defineTheme('sim-light', {
      base: 'vs',
      inherit: true,
      rules: SIM_LIGHT_RULES,
      colors: {
        'editor.background': '#fefefe',
        'editor.foreground': '#1a1a1a',
        'editorLineNumber.foreground': '#bbbbbb',
        'editorLineNumber.activeForeground': '#707070',
        'editor.selectionBackground': '#0078d430',
        'editor.inactiveSelectionBackground': '#0078d418',
        'editor.lineHighlightBackground': '#f7f7f7',
        'editor.lineHighlightBorder': '#00000000',
        'editorGutter.background': '#fefefe',
        'editorWidget.background': '#ffffff',
        'editorWidget.border': '#dedede',
        'editorWidget.foreground': '#1a1a1a',
        'editor.findMatchBackground': '#0078d428',
        'editor.findMatchHighlightBackground': '#0078d414',
        'editor.findMatchBorder': '#0078d4',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#dedede80',
        'scrollbarSlider.hoverBackground': '#cccccc',
        'scrollbarSlider.activeBackground': '#b0b0b0',
        'editorBracketMatch.background': '#0078d418',
        'editorBracketMatch.border': '#0078d480',
        'editorIndentGuide.background1': '#f0f0f0',
        'editorIndentGuide.activeBackground1': '#d8d8d8',
        'editorCursor.foreground': '#1a1a1a',
        'editor.wordHighlightBackground': '#0078d414',
        'editor.wordHighlightBorder': '#0078d450',
        'editorSuggestWidget.background': '#ffffff',
        'editorSuggestWidget.border': '#dedede',
        'editorSuggestWidget.foreground': '#1a1a1a',
        'editorSuggestWidget.selectedBackground': '#f5f5f5',
        'editorSuggestWidget.selectedForeground': '#1a1a1a',
        'editorHoverWidget.background': '#ffffff',
        'editorHoverWidget.border': '#dedede',
        'editorHoverWidget.foreground': '#1a1a1a',
        'minimap.background': '#fefefe',
        'minimapSlider.background': '#dedede80',
        focusBorder: '#0078d480',
        'input.background': '#ffffff',
        'input.border': '#dedede',
        'input.foreground': '#1a1a1a',
        'inputOption.activeBorder': '#0078d4',
      },
    })

    return Editor
  },
  { ssr: false }
)

function subscribeToThemeClass(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const getIsDarkSnapshot = () => document.documentElement.classList.contains('dark')
const getServerIsDarkSnapshot = () => false

/** `sim-dark` or `sim-light`, following the document theme class. */
export function useMonacoTheme(): string {
  const isDark = useSyncExternalStore(
    subscribeToThemeClass,
    getIsDarkSnapshot,
    getServerIsDarkSnapshot
  )
  return isDark ? 'sim-dark' : 'sim-light'
}
