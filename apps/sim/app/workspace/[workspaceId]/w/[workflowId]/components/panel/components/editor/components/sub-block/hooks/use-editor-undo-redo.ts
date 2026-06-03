import type React from 'react'
import { useCallback, useRef } from 'react'
import { useUndoRedo } from '@/hooks/use-undo-redo'

/**
 * Routes undo/redo keyboard shortcuts to the workflow undo stack while a text
 * editor is focused, suppressing the browser/editor-native undo so the workflow
 * stack stays the single source of truth.
 *
 * The returned handler is stable for the lifetime of the component and always
 * calls the latest undo/redo (via refs), so it is safe to use inside callbacks
 * with empty dependency arrays.
 *
 * @returns A keydown handler that returns `true` when it handled an undo/redo
 *   shortcut, letting callers stop further processing of the event.
 */
export function useEditorUndoRedo() {
  const { undo, redo } = useUndoRedo()
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  undoRef.current = undo
  redoRef.current = redo

  return useCallback((event: React.KeyboardEvent): boolean => {
    if (!(event.metaKey || event.ctrlKey)) return false

    const key = event.key.toLowerCase()
    const isUndo = key === 'z' && !event.shiftKey
    const isRedo = (key === 'z' && event.shiftKey) || key === 'y'
    if (!isUndo && !isRedo) return false

    event.preventDefault()
    event.stopPropagation()
    if (isUndo) {
      undoRef.current()
    } else {
      redoRef.current()
    }
    return true
  }, [])
}
