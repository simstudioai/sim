'use client'

import { useEffect, useRef } from 'react'

/**
 * Runs a drag's teardown wherever the drag actually ends.
 *
 * `dragend` fires on the SOURCE ROW, which is not guaranteed to still exist: spring-loading
 * navigates into another folder mid-drag, which unmounts it. A row-level handler would then
 * never run, leaving the drag ghost stuck on the page, every row frozen at drag opacity, and a
 * stale source id that makes the next drop resolve against rows the user never picked up.
 *
 * Listening on `window` catches the event wherever it lands — including a drag cancelled with
 * Escape or released outside the window, which never reaches a row at all.
 *
 * `teardown` is read through a ref and the listeners bind once, deliberately. Depending on the
 * callback would re-run this effect on every render, and any cleanup wired into it would then
 * abort drags that are still in progress — a bug this exact hook already shipped once.
 */
export function useDragTeardown(teardown: () => void): void {
  const teardownRef = useRef<() => void>(teardown)
  teardownRef.current = teardown

  useEffect(() => {
    const handleDragEnd = () => teardownRef.current()
    window.addEventListener('dragend', handleDragEnd)
    window.addEventListener('drop', handleDragEnd)
    return () => {
      window.removeEventListener('dragend', handleDragEnd)
      window.removeEventListener('drop', handleDragEnd)
    }
  }, [])
}
