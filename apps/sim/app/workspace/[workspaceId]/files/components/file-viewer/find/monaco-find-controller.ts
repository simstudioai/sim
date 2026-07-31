import type { editor as MonacoEditorTypes } from 'monaco-editor'
import type { FindController, FindFlags, FindResultReporter } from './types'

const MATCH_CLASS = 'file-find-match'
const CURRENT_MATCH_CLASS = 'file-find-match-current'

interface MonacoFindControllerOptions {
  getEditor: () => MonacoEditorTypes.IStandaloneCodeEditor | null
  report: FindResultReporter
  priority: number
}

/**
 * Drives find over a Monaco editor under the file find bar. Uses Monaco's own `findMatches`
 * (piece-tree search) and decoration collections (viewport-virtualized), so it scales to multi-MB
 * files. Find-only; Monaco's own find widget is suppressed (see `text-editor.tsx`) so Cmd+F opens the
 * shared bar instead.
 */
export function createMonacoFindController({
  getEditor,
  report,
  priority,
}: MonacoFindControllerOptions): FindController {
  let matches: MonacoEditorTypes.FindMatch[] = []
  let currentIndex = -1
  let decorations: MonacoEditorTypes.IEditorDecorationsCollection | null = null

  const clearDecorations = () => decorations?.clear()

  const applyDecorations = () => {
    const editor = getEditor()
    if (!editor) return
    decorations ??= editor.createDecorationsCollection()
    decorations.set(
      matches.map((match, index) => ({
        range: match.range,
        options: {
          className: index === currentIndex ? CURRENT_MATCH_CLASS : MATCH_CLASS,
          stickiness: 1, // NeverGrowsWhenTypingAtEdges
        },
      }))
    )
  }

  const revealCurrent = () => {
    const editor = getEditor()
    if (!editor || currentIndex < 0) return
    editor.revealRangeInCenterIfOutsideViewport(matches[currentIndex].range)
  }

  const reportResult = () => report({ count: matches.length, currentIndex, truncated: false })

  const runSearch = (query: string, flags: FindFlags) => {
    const editor = getEditor()
    const model = editor?.getModel()
    if (!editor || !model || !query) {
      matches = []
      currentIndex = -1
      clearDecorations()
      reportResult()
      return
    }
    matches = model.findMatches(query, false, flags.regex, flags.caseSensitive, null, true)
    currentIndex = matches.length > 0 ? 0 : -1
    applyDecorations()
    revealCurrent()
    reportResult()
  }

  const step = (delta: number) => {
    if (matches.length === 0) return
    currentIndex = (currentIndex + delta + matches.length) % matches.length
    applyDecorations()
    revealCurrent()
    reportResult()
  }

  return {
    priority,
    search: runSearch,
    next: () => step(1),
    prev: () => step(-1),
    focusTarget: () => getEditor()?.focus(),
    dispose: clearDecorations,
  }
}
