'use client'

import type { DragEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * Inline chrome for the drag image. It is set on a detached DOM node handed to `setDragImage`,
 * so it cannot be a Tailwind class list.
 *
 * `font-family` is deliberately absent: the node is appended to `<body>`, so omitting it lets
 * the label inherit the app font and match the row it was lifted from.
 */
const DRAG_GHOST_STYLE =
  'position:fixed;top:-500px;left:0;display:inline-flex;align-items:center;padding:4px 10px;background:var(--surface-active);border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text-body);white-space:nowrap;pointer-events:none;box-shadow:var(--shadow-medium);z-index:var(--z-toast)'

const DRAG_GHOST_LABEL_STYLE = 'max-width:200px;overflow:hidden;text-overflow:ellipsis'

export interface RowDragGhost {
  /** Builds the drag image for this drag and attaches it to the event. */
  attach: (e: DragEvent<HTMLElement>, label: string, count: number) => void
  /** Removes the ghost node. Safe to call when none is attached. */
  remove: () => void
}

/**
 * The drag image shown while dragging resource rows — the first row's label, plus a count when
 * the drag carries a multi-row selection.
 *
 * Shared so every foldered list lifts rows the same way. The node lives on `document.body`
 * rather than in the React tree because `setDragImage` snapshots a real, laid-out element; the
 * unmount cleanup is the backstop for a drag whose source row disappears before it ends.
 */
export function useRowDragGhost(): RowDragGhost {
  const ghostRef = useRef<HTMLElement | null>(null)

  const remove = useCallback(() => {
    ghostRef.current?.remove()
    ghostRef.current = null
  }, [])

  useEffect(() => remove, [remove])

  const attach = useCallback((e: DragEvent<HTMLElement>, label: string, count: number) => {
    const ghost = document.createElement('div')
    ghost.style.cssText = DRAG_GHOST_STYLE
    const text = document.createElement('span')
    text.style.cssText = DRAG_GHOST_LABEL_STYLE
    text.textContent = count > 1 ? `${label} +${count - 1} more` : label
    ghost.appendChild(text)
    document.body.appendChild(ghost)
    // Force a layout pass so the drag image is measurable before it is captured.
    void ghost.offsetHeight
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
    ghostRef.current = ghost
  }, [])

  /**
   * Stable identity, not a fresh object per render — the same requirement
   * {@link useSpringLoadedFolder} documents. Consumers list this handle in the deps of the
   * `endDrag` callback that `useDragTeardown` binds and that the drag-config memo depends on,
   * so a new object each render makes `endDrag` unstable and rebuilds the whole drag config
   * every render, re-rendering every memoized row. The inner callbacks are already stable, so
   * this memo never invalidates.
   */
  return useMemo(() => ({ attach, remove }), [attach, remove])
}
