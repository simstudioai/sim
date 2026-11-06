'use client'

import { type RefObject, useEffect, useRef } from 'react'

const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

interface UseRemovedRowFocusOptions {
  /** The rows on screen, in order. */
  rowIds: readonly string[]
  /** The rendered row at an index of `rowIds`, if any. */
  rowAt: (index: number) => Element | null | undefined
  /** Takes focus when no row is left. */
  list: RefObject<HTMLElement | null>
  /** The confirm is open. Closing it hands focus back to the trigger, so focus settles only after. */
  confirming: boolean
}

/**
 * A confirm returns focus to the control that opened it, which goes away with its row and leaves
 * focus on the body. Once the row is gone and the confirm is closed, this moves focus to the row that
 * took its place, then the one before, then the list. Focus already somewhere else stays there.
 *
 * @returns Runs a removal, and arms the move only if it succeeds.
 */
export function useRemovedRowFocus({ rowIds, rowAt, list, confirming }: UseRemovedRowFocusOptions) {
  const removed = useRef<{ id: string; index: number } | null>(null)

  useEffect(() => {
    const row = removed.current
    if (!row || confirming || rowIds.includes(row.id)) return
    removed.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    const next = rowAt(row.index) ?? (row.index > 0 ? rowAt(row.index - 1) : null)
    const target = next?.querySelector<HTMLElement>(TABBABLE)
    if (target) return target.focus({ preventScroll: true })
    if (!list.current) return
    list.current.tabIndex = -1
    list.current.focus({ preventScroll: true })
  })

  return async function removeRow<T>(id: string, work: () => Promise<T>) {
    const index = rowIds.indexOf(id)
    const result = await work()
    removed.current = { id, index }
    return result
  }
}
