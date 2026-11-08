'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const NONE: ReadonlySet<string> = new Set()
const NO_ANCHOR = -1

/** A keystroke someone is typing, or one a dialog or menu owns, is not the list's. */
function ownedElsewhere(target: EventTarget | null) {
  const element = target instanceof Element ? target : document.activeElement
  if (!element) return false
  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], dialog'
    ) || document.querySelector('dialog[open]')
  )
}

/** The list's checkbox selection, from `useResourceSelection`. */
export interface ResourceSelection {
  selected: ReadonlySet<string>
  /** Checks or unchecks one row; a shift-click extends the range from the last row checked. */
  toggle: (rowId: string, checked: boolean, extend: boolean) => void
  toggleAll: (checked: boolean) => void
  /** Collapses the selection to exactly these rows, as a right-click or a drag start does. */
  replace: (rowIds: Iterable<string>) => void
  clear: () => void
}

interface UseResourceSelectionOptions {
  /** The rows on screen, in order: ranges walk it and rows that leave it leave the selection. */
  rowIds: readonly string[]
  /** Bound to Delete and Backspace while rows are selected. */
  onDelete?: () => void
  /** Turns the keyboard shortcuts off, such as while a row is being renamed. */
  keyboardBlocked?: boolean
}

/**
 * Checkbox selection for a resource list: click, shift-click ranges, select all, and the
 * Cmd/Ctrl+A, Escape and Delete shortcuts. Rows that leave the list leave the selection, so a bulk
 * action never reaches a row the reader can no longer see.
 */
export function useResourceSelection({
  rowIds,
  onDelete,
  keyboardBlocked = false,
}: UseResourceSelectionOptions): ResourceSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(NONE)
  const anchor = useRef(NO_ANCHOR)
  const live = useRef({ rowIds, onDelete, keyboardBlocked, selected })
  live.current = { rowIds, onDelete, keyboardBlocked, selected }

  // Compared by content, so a caller passing a fresh array of the same rows never re-renders.
  const [shownRows, setShownRows] = useState(rowIds)
  if (shownRows !== rowIds) {
    const same =
      shownRows.length === rowIds.length && shownRows.every((id, index) => id === rowIds[index])
    if (!same) {
      setShownRows(rowIds)
      anchor.current = NO_ANCHOR
      if (selected.size) {
        const visible = new Set(rowIds)
        const kept = [...selected].filter((id) => visible.has(id))
        if (kept.length !== selected.size) setSelected(kept.length ? new Set(kept) : NONE)
      }
    }
  }

  const clear = useCallback(() => {
    anchor.current = NO_ANCHOR
    setSelected((current) => (current.size ? NONE : current))
  }, [])

  const replace = useCallback((next: Iterable<string>) => {
    const ids = new Set(next)
    anchor.current = ids.size === 1 ? live.current.rowIds.indexOf([...ids][0]) : NO_ANCHOR
    setSelected(ids)
  }, [])

  const toggle = useCallback((rowId: string, checked: boolean, extend: boolean) => {
    const ids = live.current.rowIds
    const index = ids.indexOf(rowId)
    if (extend && anchor.current !== NO_ANCHOR && index !== NO_ANCHOR) {
      const start = Math.min(anchor.current, index)
      const end = Math.max(anchor.current, index)
      setSelected((current) => {
        const next = new Set(current)
        for (let at = start; at <= end; at++) next.add(ids[at])
        return next
      })
      anchor.current = index
      return
    }
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(rowId)
      else next.delete(rowId)
      return next.size ? next : NONE
    })
    anchor.current = checked ? index : NO_ANCHOR
  }, [])

  const toggleAll = useCallback((checked: boolean) => {
    anchor.current = NO_ANCHOR
    setSelected(checked ? new Set(live.current.rowIds) : NONE)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const { keyboardBlocked, selected, rowIds, onDelete } = live.current
      if (keyboardBlocked || event.defaultPrevented || ownedElsewhere(event.target)) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size && onDelete) {
        event.preventDefault()
        onDelete()
      } else if (event.key === 'Escape' && selected.size) {
        event.preventDefault()
        clear()
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'a' && rowIds.length) {
        event.preventDefault()
        anchor.current = NO_ANCHOR
        setSelected(new Set(rowIds))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clear])

  return { selected, toggle, toggleAll, replace, clear }
}
