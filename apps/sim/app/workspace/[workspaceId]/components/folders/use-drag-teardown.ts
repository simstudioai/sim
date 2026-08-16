'use client'

import { useEffect, useRef } from 'react'

/**
 * Runs a drag's teardown wherever the drag actually ends.
 *
 * Three signals, because no single one is reliable here:
 *
 * 1. `drop` on `window` — a release over any valid target, wherever it bubbles from.
 * 2. `dragend` on `window` — the normal end of a drag whose source row still exists.
 * 3. `pointermove` on `window` — the case the first two miss. `dragend` is dispatched *at the
 *    source node*, so once spring-loading navigates the list and unmounts that row, the event
 *    has no path to `window` and neither listener above ever runs. Cancelling with Escape or
 *    releasing over nothing then leaves the ghost on the page, every row frozen at drag
 *    opacity, and the spring-open set uncleared so those folders refuse to open again.
 *
 * The third signal works because browsers suppress mouse and pointer events for the duration of
 * a native drag: the first `pointermove` after one starts can only mean it is over. That makes
 * it exact, where a timer is not — the drag model fires `dragover` on roughly a 350ms cadence
 * while the pointer is stationary, so an idle-timeout version of this tore down mid-drag
 * whenever the user rested on a folder waiting for it to spring open.
 *
 * `teardown` is read through a ref and the listeners bind once, deliberately. Depending on the
 * callback would re-run this effect on every render, and the teardown wired into it would then
 * abort drags that are still in progress — a bug this exact hook already shipped once.
 */
export function useDragTeardown(teardown: () => void): void {
  const teardownRef = useRef<() => void>(teardown)
  teardownRef.current = teardown

  useEffect(() => {
    /**
     * Set from `dragover` rather than `dragstart` so the flag only turns on once a drag is
     * genuinely under way, and so a stray `pointermove` before the drag engages cannot tear
     * down a drag that never started.
     */
    let isDragging = false

    const markDragging = () => {
      isDragging = true
    }

    const endDrag = () => {
      if (!isDragging) return
      isDragging = false
      teardownRef.current()
    }

    window.addEventListener('dragover', markDragging)
    window.addEventListener('dragend', endDrag)
    window.addEventListener('drop', endDrag)
    window.addEventListener('pointermove', endDrag)
    return () => {
      window.removeEventListener('dragover', markDragging)
      window.removeEventListener('dragend', endDrag)
      window.removeEventListener('drop', endDrag)
      window.removeEventListener('pointermove', endDrag)
    }
  }, [])
}
