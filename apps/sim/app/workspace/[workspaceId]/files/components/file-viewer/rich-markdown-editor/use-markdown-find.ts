'use client'

import { useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { useRegisterFindController } from '@/app/workspace/[workspaceId]/files/components/file-viewer/find/find-context'
import {
  FIND_PRIORITY,
  type FindController,
  type FindResult,
  type FindResultReporter,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/find/types'
import { type FindPluginState, findPluginKey, getFindState } from './find-plugin'

const EMPTY_FLAGS = { caseSensitive: false, wholeWord: false, regex: false }

function toResult(state: FindPluginState): FindResult {
  return {
    count: state.total,
    currentIndex: state.currentIndex,
    truncated: state.truncated,
  }
}

/**
 * Builds a find controller over a TipTap markdown editor. Search and stepping run through the
 * {@link findPluginKey} plugin via `setMeta` (no doc mutation, so they never sync to collaborators or
 * enter the undo stack); stepping scrolls the match into view without moving the document selection.
 * Find-only.
 */
export function createMarkdownFindController(
  editor: Editor,
  report: FindResultReporter
): FindController {
  const revealCurrent = () => {
    const state = getFindState(editor.state)
    const match = state.matches[state.currentIndex]
    if (!match) return
    const { node } = editor.view.domAtPos(match.from)
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
    element?.scrollIntoView?.({ block: 'center' })
  }

  const reportNow = () => report(toResult(getFindState(editor.state)))

  const step = (delta: number) => {
    const state = getFindState(editor.state)
    if (state.matches.length === 0) return
    const index = (state.currentIndex + delta + state.matches.length) % state.matches.length
    editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, { currentIndex: index }))
    reportNow()
    revealCurrent()
  }

  // Keep the count in sync while the doc changes underneath an open find — the user's own edits and,
  // in a collaborative doc, remote peers' edits (both arrive as doc-changing transactions).
  const onUpdate = () => {
    if (getFindState(editor.state).query) reportNow()
  }
  editor.on('update', onUpdate)

  return {
    priority: FIND_PRIORITY.editor,
    search: (query, flags) => {
      editor.view.dispatch(
        editor.state.tr.setMeta(findPluginKey, { query, flags, currentIndex: 0 })
      )
      reportNow()
      revealCurrent()
    },
    next: () => step(1),
    prev: () => step(-1),
    focusTarget: () => editor.commands.focus(),
    dispose: () => {
      editor.off('update', onUpdate)
      if (!editor.isDestroyed) {
        editor.view.dispatch(
          editor.state.tr.setMeta(findPluginKey, { query: '', flags: EMPTY_FLAGS, currentIndex: 0 })
        )
      }
    },
  }
}

/** No-op controller registered before the editor exists, so nothing searchable is active yet. */
function createPendingController(): FindController {
  return {
    priority: FIND_PRIORITY.editor,
    search: () => {},
    next: () => {},
    prev: () => {},
    focusTarget: () => {},
    dispose: () => {},
  }
}

/** Registers the markdown editor as a searchable find surface; re-registers when the editor changes. */
export function useMarkdownFindController(editor: Editor | null) {
  const factory = useCallback(
    (report: FindResultReporter) =>
      editor ? createMarkdownFindController(editor, report) : createPendingController(),
    [editor]
  )

  useRegisterFindController(factory, [editor])
}
