'use client'

import { useEffect, useRef } from 'react'

/**
 * How long `dragover` must go silent before the drag is presumed over.
 *
 * `dragover` fires continuously (roughly per animation frame) for as long as a drag is live and
 * inside the window, so a gap this long means the drag ended somewhere no event of ours can
 * observe. Generous on purpose: the cost of firing late is a few frames of stale drag styling,
 * while firing early would tear down a drag the user is still holding.
 */
const DRAG_IDLE_TEARDOWN_MS = 400

/**
 * Runs a drag's teardown wherever the drag actually ends.
 *
 * Three signals, because no single one is reliable here:
 *
 * 1. `drop` on `window` — a release over any valid target, wherever it bubbles from.
 * 2. `dragend` on `window` — the normal end of a drag whose source row still exists.
 * 3. A `dragover` idle watchdog — the case the first two miss. `dragend` is dispatched *at the
 *    source node*, so once spring-loading navigates the list and unmounts that row, the event
 *    has no path to `window` and neither listener above ever runs. Cancelling with Escape or
 *    releasing over nothing then leaves the ghost on the page, every row frozen at drag
 *    opacity, and the spring-open set uncleared so those folders refuse to open again.
 *
 * The watchdog also covers a drag that leaves the window entirely. If it re-enters, the visual
 * state has been reset but the drop still resolves — the row ids live in `dataTransfer`, not in
 * the state this tears down.
 *
 * `teardown` is read through a ref and the listeners bind once, deliberately. Depending on the
 * callback would re-run this effect on every render, and the teardown wired into it would then
 * abort drags that are still in progress — a bug this exact hook already shipped once.
 */
export function useDragTeardown(teardown: () => void): void {
  const teardownRef = useRef<() => void>(teardown)
  teardownRef.current = teardown

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const clearIdleTimer = () => {
      if (idleTimer !== null) clearTimeout(idleTimer)
      idleTimer = null
    }

    const runTeardown = () => {
      clearIdleTimer()
      teardownRef.current()
    }

    /** Restarted on every `dragover`; only elapses once the drag stops reporting. */
    const handleDragOver = () => {
      clearIdleTimer()
      idleTimer = setTimeout(runTeardown, DRAG_IDLE_TEARDOWN_MS)
    }

    window.addEventListener('dragend', runTeardown)
    window.addEventListener('drop', runTeardown)
    window.addEventListener('dragover', handleDragOver)
    return () => {
      clearIdleTimer()
      window.removeEventListener('dragend', runTeardown)
      window.removeEventListener('drop', runTeardown)
      window.removeEventListener('dragover', handleDragOver)
    }
  }, [])
}
