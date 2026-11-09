'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * How long a drag must rest on a folder before it opens.
 *
 * Deliberately slower than the workflow sidebar's 400ms hover-to-expand: that one opens a tree
 * node in place and is trivially reversible, while this one navigates the whole list view out
 * from under the drag. At 700ms a drag merely crossing a folder on its way elsewhere kept
 * triggering it; the cost of waiting is far lower than the cost of an unwanted navigation.
 */
export const SPRING_LOAD_DELAY_MS = 1000

/** How a spring-open writes the newly opened folder to the browser history. */
export interface SpringOpenOptions {
  history: 'push' | 'replace'
}

export interface UseSpringLoadedFolderOptions {
  /**
   * Opens the folder mid-drag. The drag continues in the newly opened folder.
   *
   * `options.history` is `'push'` for the first folder a drag opens and `'replace'` for every
   * one after, so one gesture leaves exactly one back-stack entry and Back returns to the
   * folder the drag started in. Pushing every level would record folders the user only rested
   * over while deciding where to drop; replacing every level would overwrite the entry they
   * were actually standing on, so Back would leave the page instead of returning to it.
   */
  onSpringOpen: (folderId: string | null, options: SpringOpenOptions) => void
  delayMs?: number
}

export interface SpringLoadedFolder {
  /**
   * Starts (or continues) the timer for `folderId`. Safe to call on every `dragover`, which
   * fires continuously: re-arming the folder already being timed does not restart it, so the
   * countdown reflects how long the drag has actually rested there.
   */
  arm: (folderId: string | null) => void
  /** Cancels the pending open — the drag left the row, or the row stopped being a valid target. */
  disarm: () => void
  /** Cancels the pending open and forgets that this drag opened anything. Call when the drag ends. */
  reset: () => void
}

/**
 * Spring-loaded folders: resting a drag on a folder row opens it, so a resource can be filed
 * into a nested folder in one gesture instead of being dropped, navigated, and dragged again.
 *
 * The dragged rows unmount when the list re-renders into the newly opened folder, which is why
 * the drag payload has to live in `dataTransfer` rather than only in the source row's state.
 *
 * A folder may open more than once in a single drag: walking back out through the breadcrumb and
 * descending again is a normal way to change your mind mid-gesture, and refusing the second entry
 * strands the drag one level up. Nothing oscillates, because every open costs another full
 * {@link SPRING_LOAD_DELAY_MS} of the drag holding still, and {@link useSpringNavigation} refuses
 * to arm the folder already on screen.
 */
export function useSpringLoadedFolder({
  onSpringOpen,
  delayMs = SPRING_LOAD_DELAY_MS,
}: UseSpringLoadedFolderOptions): SpringLoadedFolder {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Folder the timer is counting down for, so re-arming it is a no-op. `undefined` means
   * nothing is armed — `null` is a real destination here, the workspace root.
   */
  const armedFolderIdRef = useRef<string | null | undefined>(undefined)
  /** Whether this drag has already sprung a folder open, which decides push vs. replace. */
  const hasOpenedRef = useRef(false)

  const onSpringOpenRef = useRef(onSpringOpen)
  onSpringOpenRef.current = onSpringOpen

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    armedFolderIdRef.current = undefined
  }, [])

  /** A drag can outlive the list that started it; never leave a timer pointing at a dead tree. */
  useEffect(() => clearTimer, [clearTimer])

  const arm = useCallback(
    (folderId: string | null) => {
      if (armedFolderIdRef.current === folderId) return

      /**
       * The drag has moved to a different row, so any countdown started on the previous one is
       * stale — cancel it before deciding whether this row can spring. Returning early without
       * this would let the folder the drag just left open behind the cursor.
       */
      clearTimer()
      armedFolderIdRef.current = folderId
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        armedFolderIdRef.current = undefined
        const isFirstOpenOfDrag = !hasOpenedRef.current
        hasOpenedRef.current = true
        onSpringOpenRef.current(folderId, {
          history: isFirstOpenOfDrag ? 'push' : 'replace',
        })
      }, delayMs)
    },
    [clearTimer, delayMs]
  )

  const reset = useCallback(() => {
    clearTimer()
    hasOpenedRef.current = false
  }, [clearTimer])

  /**
   * Stable identity, not a fresh object per render. Consumers feed this handle into a
   * `useCallback` that a drag-lifecycle effect depends on; a new object each render re-runs
   * that effect continuously, and its cleanup then tears down the drag that is still in
   * progress. The inner callbacks are already stable, so this memo never invalidates.
   */
  return useMemo(() => ({ arm, disarm: clearTimer, reset }), [arm, clearTimer, reset])
}
