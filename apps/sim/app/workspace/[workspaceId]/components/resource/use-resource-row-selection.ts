'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SelectableConfig } from '@/app/workspace/[workspaceId]/components/resource/resource'

/** Shared empty set so an empty selection keeps a stable identity across renders. */
const EMPTY_ROW_IDS = new Set<string>()

/** Sentinel for "no shift-range anchor", so index 0 stays a usable anchor. */
const NO_ANCHOR = -1

/**
 * True while a text-entry surface owns the keystroke, so the list shortcuts never eat a
 * character the user is typing into a rename field, a search box, or an editor.
 */
function isTypingTarget(): boolean {
  const active = document.activeElement
  if (!active) return false
  return (
    active.tagName === 'INPUT' ||
    active.tagName === 'TEXTAREA' ||
    (active as HTMLElement).isContentEditable
  )
}

export interface UseResourceRowSelectionOptions {
  /**
   * Row ids currently rendered, in display order. Selection is pruned to this list whenever it
   * changes (navigating into a folder, applying a filter) and shift-ranges walk it, so it must
   * be the same array identity across renders that do not change the rows.
   */
  visibleRowIds: string[]
  /**
   * Blocks the keyboard shortcuts while another surface owns the keystroke — a detail view open
   * over the list, an inline rename in progress, a modal. Text inputs are already excluded.
   */
  isKeyboardBlocked?: () => boolean
  /** Bound to Delete/Backspace on a non-empty selection. Omit to leave those keys unbound. */
  onDeleteSelected?: () => void
}

export interface ResourceRowSelection {
  selectedRowIds: Set<string>
  /** Passed straight to `Resource.Table`'s `selectable` prop. */
  selectable: SelectableConfig
  /** Collapses the selection to exactly these rows, e.g. a plain row click or a drag start. */
  replaceSelection: (rowIds: Iterable<string>) => void
  clearSelection: () => void
}

/**
 * Checkbox selection for a `Resource.Table` list: click, shift-click ranges, select-all, and the
 * Cmd/Ctrl+A · Escape · Delete shortcuts, shared so Files, Tables, and Knowledge select
 * identically rather than each re-deriving the same state machine.
 *
 * Selection is keyed by *row* id, not resource id, so a foldered list can hold folder rows and
 * resource rows in one selection; consumers split it back out with `parseFolderedRowId`.
 */
export function useResourceRowSelection({
  visibleRowIds,
  isKeyboardBlocked,
  onDeleteSelected,
}: UseResourceRowSelectionOptions): ResourceRowSelection {
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => EMPTY_ROW_IDS)

  /** Anchor for shift-click ranges — an index into `visibleRowIds`, not a row id. */
  const anchorIndexRef = useRef<number>(NO_ANCHOR)

  const visibleRowIdsRef = useRef(visibleRowIds)
  visibleRowIdsRef.current = visibleRowIds
  const isKeyboardBlockedRef = useRef(isKeyboardBlocked)
  isKeyboardBlockedRef.current = isKeyboardBlocked
  const onDeleteSelectedRef = useRef(onDeleteSelected)
  onDeleteSelectedRef.current = onDeleteSelected

  const clearSelection = useCallback(() => {
    anchorIndexRef.current = NO_ANCHOR
    setSelectedRowIds((prev) => (prev.size === 0 ? prev : EMPTY_ROW_IDS))
  }, [])

  const replaceSelection = useCallback((rowIds: Iterable<string>) => {
    const next = new Set(rowIds)
    /**
     * A single row becomes the next shift anchor; a multi-row replacement has no meaningful
     * anchor, so the following shift-click starts a fresh range instead of extending from a
     * row the user never clicked.
     */
    let anchor = NO_ANCHOR
    if (next.size === 1) {
      for (const rowId of next) anchor = visibleRowIdsRef.current.indexOf(rowId)
    }
    anchorIndexRef.current = anchor
    setSelectedRowIds(next)
  }, [])

  /**
   * Rows that left the list — navigating into a folder, applying a filter — are gone as far as
   * selection is concerned, otherwise a bulk action would silently operate on rows the user can
   * no longer see. Compared by identity because `visibleRowIds` is memoized upstream and only
   * changes when the rows really change.
   */
  const prevVisibleRowIdsRef = useRef(visibleRowIds)
  useEffect(() => {
    if (prevVisibleRowIdsRef.current === visibleRowIds) return
    /**
     * Identity is only a cheap first test — it changes for reasons that are not list changes.
     * Both foldered pages rebuild every row on each inline-rename keystroke (the edit value
     * lives in the row memo), so a rename would otherwise clear the shift anchor mid-edit and
     * the next shift-click would start a fresh range instead of extending the user's.
     */
    const unchanged =
      prevVisibleRowIdsRef.current.length === visibleRowIds.length &&
      prevVisibleRowIdsRef.current.every((rowId, index) => rowId === visibleRowIds[index])
    prevVisibleRowIdsRef.current = visibleRowIds
    if (unchanged) return
    anchorIndexRef.current = NO_ANCHOR
    const visible = new Set(visibleRowIds)
    setSelectedRowIds((prev) => {
      if (prev.size === 0) return prev
      const next = new Set<string>()
      for (const rowId of prev) if (visible.has(rowId)) next.add(rowId)
      return next.size === prev.size ? prev : next
    })
  }, [visibleRowIds])

  /**
   * The size check short-circuits the common case (a selection smaller than the list) in O(1);
   * this runs on every render of the page, including each one a drag triggers.
   */
  const isAllSelected =
    visibleRowIds.length > 0 &&
    selectedRowIds.size >= visibleRowIds.length &&
    visibleRowIds.every((rowId) => selectedRowIds.has(rowId))

  const selectable = useMemo<SelectableConfig>(
    () => ({
      selectedIds: selectedRowIds,
      isAllSelected,
      onSelectRow: (rowId, checked, shiftKey) => {
        const currentIndex = visibleRowIds.indexOf(rowId)
        if (shiftKey && anchorIndexRef.current !== NO_ANCHOR && currentIndex !== NO_ANCHOR) {
          const start = Math.min(anchorIndexRef.current, currentIndex)
          const end = Math.max(anchorIndexRef.current, currentIndex)
          setSelectedRowIds((prev) => {
            const next = new Set(prev)
            for (let i = start; i <= end; i++) next.add(visibleRowIds[i])
            return next
          })
          anchorIndexRef.current = currentIndex
          return
        }
        setSelectedRowIds((prev) => {
          const next = new Set(prev)
          if (checked) next.add(rowId)
          else next.delete(rowId)
          return next
        })
        anchorIndexRef.current = checked ? currentIndex : NO_ANCHOR
      },
      onSelectAll: (checked) => {
        anchorIndexRef.current = NO_ANCHOR
        setSelectedRowIds((prev) => {
          const next = new Set(prev)
          for (const rowId of visibleRowIds) {
            if (checked) next.add(rowId)
            else next.delete(rowId)
          }
          return next
        })
      },
      disabled: false,
    }),
    [selectedRowIds, isAllSelected, visibleRowIds]
  )

  const selectedRowIdsRef = useRef(selectedRowIds)
  selectedRowIdsRef.current = selectedRowIds

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isKeyboardBlockedRef.current?.()) return
      if (isTypingTarget()) return

      const hasSelection = selectedRowIdsRef.current.size > 0

      if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection) {
        if (!onDeleteSelectedRef.current) return
        e.preventDefault()
        onDeleteSelectedRef.current()
        return
      }

      if (e.key === 'Escape' && hasSelection) {
        e.preventDefault()
        clearSelection()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && visibleRowIdsRef.current.length > 0) {
        e.preventDefault()
        anchorIndexRef.current = NO_ANCHOR
        setSelectedRowIds(new Set(visibleRowIdsRef.current))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearSelection])

  return { selectedRowIds, selectable, replaceSelection, clearSelection }
}
