import type { editor } from 'monaco-editor'
import { tokenColors } from '@/components/file-viewer/resolve-colors'

const TOKENS = [
  '--ui-reading',
  '--ui-ink',
  '--ui-secondary',
  '--ui-muted',
  '--ui-border',
  '--ui-divider',
  '--ui-hover',
  '--ui-selected',
  '--status-info',
  '--status-success',
  '--status-warning',
  '--control-danger',
] as const

/** The theme name for `theme`, defined (or redefined) from the tokens `host` resolves now. */
export function defineSurfaceTheme(
  monaco: { editor: { defineTheme: (name: string, data: editor.IStandaloneThemeData) => void } },
  host: HTMLElement,
  theme: 'light' | 'dark'
): string {
  const c = tokenColors(host, TOKENS)
  const hex = (token: (typeof TOKENS)[number]) => c[token].replace('#', '').slice(0, 6)
  const name = theme === 'dark' ? 'sim-dark' : 'sim-light'
  monaco.editor.defineTheme(name, {
    base: theme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: hex('--ui-secondary'), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex('--status-info') },
      { token: 'keyword.control', foreground: hex('--status-info') },
      { token: 'storage', foreground: hex('--status-info') },
      { token: 'tag', foreground: hex('--status-info') },
      { token: 'attribute.name', foreground: hex('--status-info') },
      { token: 'variable', foreground: hex('--status-info') },
      { token: 'string.link', foreground: hex('--status-info') },
      { token: 'number', foreground: hex('--status-success') },
      { token: 'number.float', foreground: hex('--status-success') },
      { token: 'number.hex', foreground: hex('--status-success') },
      { token: 'constant', foreground: hex('--status-success') },
      { token: 'string', foreground: hex('--status-warning') },
      { token: 'string.escape', foreground: hex('--status-warning') },
      { token: 'attribute.value', foreground: hex('--status-warning') },
      { token: 'type', foreground: hex('--status-warning') },
      { token: 'type.identifier', foreground: hex('--status-warning') },
      { token: 'regexp', foreground: hex('--control-danger') },
      { token: 'annotation', foreground: hex('--status-warning') },
      { token: 'delimiter', foreground: hex('--ui-secondary') },
      { token: 'meta.separator', foreground: hex('--ui-muted') },
      { token: 'strong', foreground: hex('--ui-ink'), fontStyle: 'bold' },
      { token: 'emphasis', foreground: hex('--ui-ink'), fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': c['--ui-reading'],
      'editor.foreground': c['--ui-ink'],
      'editorLineNumber.foreground': c['--ui-muted'],
      'editorLineNumber.activeForeground': c['--ui-secondary'],
      'editor.selectionBackground': c['--ui-selected'],
      'editor.inactiveSelectionBackground': c['--ui-hover'],
      'editor.lineHighlightBackground': c['--ui-hover'],
      'editor.lineHighlightBorder': '#00000000',
      'editorGutter.background': c['--ui-reading'],
      'editorWidget.background': c['--ui-reading'],
      'editorWidget.border': c['--ui-border'],
      'editorWidget.foreground': c['--ui-ink'],
      'editor.findMatchBackground': c['--ui-selected'],
      'editor.findMatchHighlightBackground': c['--ui-hover'],
      'editor.findMatchBorder': c['--status-info'],
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': c['--ui-hover'],
      'scrollbarSlider.hoverBackground': c['--ui-selected'],
      'scrollbarSlider.activeBackground': c['--ui-selected'],
      'editorBracketMatch.background': c['--ui-hover'],
      'editorBracketMatch.border': c['--ui-border'],
      'editorIndentGuide.background1': c['--ui-divider'],
      'editorIndentGuide.activeBackground1': c['--ui-border'],
      'editorCursor.foreground': c['--ui-ink'],
      'editor.wordHighlightBackground': c['--ui-hover'],
      'editor.wordHighlightBorder': '#00000000',
      'editorHoverWidget.background': c['--ui-reading'],
      'editorHoverWidget.border': c['--ui-border'],
      'editorHoverWidget.foreground': c['--ui-ink'],
      focusBorder: '#00000000',
      'input.background': c['--ui-reading'],
      'input.border': c['--ui-border'],
      'input.foreground': c['--ui-ink'],
      'inputOption.activeBorder': c['--status-info'],
    },
  })
  return name
}

/** The surface's monospace family, as the editor's font. */
export function surfaceMonoFont(host: HTMLElement): string {
  const probe = document.createElement('span')
  probe.hidden = true
  probe.style.fontFamily = 'var(--font-mono)'
  host.appendChild(probe)
  const family = getComputedStyle(probe).fontFamily
  probe.remove()
  return family || 'ui-monospace, monospace'
}
