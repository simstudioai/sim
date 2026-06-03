import { useCallback, useEffect, useRef } from 'react'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Handles sidebar drag-resize with zero React renders during the drag.
 *
 * Architecture (confirmed industry best-practice for resize handles):
 *
 * pointerdown  → capture the pointer on the handle (so move/up keep arriving
 *                even when the cursor leaves the window or crosses an iframe),
 *                add `is-resizing` class directly to the DOM (no React
 *                round-trip, so the CSS width transition is suppressed from the
 *                very first frame)
 * pointermove  → write to --sidebar-width inside a requestAnimationFrame
 *                callback (aligns work with the browser paint cycle)
 * pointerup    → cancel any pending RAF, tear down, persist final width to
 *                Zustand once (one React re-render to save to localStorage)
 *
 * The drag is torn down by `pointerup`, `pointercancel`, or window `blur`, so an
 * interrupted gesture (release outside the window, alt-tab, context menu, the OS
 * stealing focus) can never leave the `is-resizing` / `sidebar-resizing` classes
 * stuck — which would otherwise freeze the sidebar at a tiny width with the
 * collapse transition permanently disabled. A single-flight guard prevents
 * stacking listeners across rapid presses, and an unmount cleanup tears down a
 * drag still in flight when the sidebar unmounts (e.g. route change).
 */
export function useSidebarResize() {
  const setSidebarWidth = useSidebarStore((s) => s.setSidebarWidth)
  const cleanupRef = useRef<(() => void) | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (cleanupRef.current) return

      const handle = e.currentTarget
      const pointerId = e.pointerId
      const sidebar = document.querySelector<HTMLElement>('.sidebar-container')
      sidebar?.classList.add('is-resizing')
      document.documentElement.classList.add('sidebar-resizing')
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      handle.setPointerCapture?.(pointerId)

      let rafId: number | null = null

      const onPointerMove = (ev: PointerEvent) => {
        if (rafId !== null) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          const max = Math.max(SIDEBAR_WIDTH.MIN, window.innerWidth * SIDEBAR_WIDTH.MAX_PERCENTAGE)
          const clamped = Math.min(Math.max(ev.clientX, SIDEBAR_WIDTH.MIN), max)
          document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`)
          rafId = null
        })
      }

      const cleanup = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        sidebar?.classList.remove('is-resizing')
        document.documentElement.classList.remove('sidebar-resizing')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
        document.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerup', endDrag)
        document.removeEventListener('pointercancel', endDrag)
        window.removeEventListener('blur', endDrag)
        cleanupRef.current = null
      }

      function endDrag() {
        cleanup()
        const raw = document.documentElement.style.getPropertyValue('--sidebar-width')
        const finalWidth = Number.parseFloat(raw)
        if (!Number.isNaN(finalWidth)) setSidebarWidth(finalWidth)
      }

      cleanupRef.current = cleanup
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', endDrag)
      document.addEventListener('pointercancel', endDrag)
      window.addEventListener('blur', endDrag)
    },
    [setSidebarWidth]
  )

  useEffect(() => () => cleanupRef.current?.(), [])

  return { handlePointerDown }
}
