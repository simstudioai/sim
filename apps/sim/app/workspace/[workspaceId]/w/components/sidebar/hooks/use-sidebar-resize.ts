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
 * pointermove  → write --sidebar-width to `.sidebar-shell-outer` (the element
 *                that sizes the rail) inside a requestAnimationFrame callback.
 *                Scoping the variable to that subtree keeps the style recalc
 *                local; writing it to `:root` instead forces a whole-document
 *                recalc (~150x slower on a large canvas).
 * pointerup    → cancel any pending RAF, tear down, persist final width to
 *                Zustand once (writes the authoritative `:root` value for
 *                on-demand readers), then drop the scoped override
 *
 * The drag is torn down by `pointerup`, `pointercancel`, or window `blur`, so an
 * interrupted gesture (release outside the window, alt-tab, context menu, the OS
 * stealing focus) can never leave the `is-resizing` / `sidebar-resizing` classes
 * stuck — which would otherwise freeze the sidebar at a tiny width with the
 * collapse transition permanently disabled. A single-flight guard prevents
 * stacking listeners across rapid presses, and unmounting mid-drag finalizes it
 * the same way a release does — persisting the last width and dropping the
 * scoped override — which matters because `.sidebar-shell-outer` lives in the
 * workspace chrome and outlives the sidebar, so a stranded override would
 * otherwise win over the committed `:root` value.
 */
export function useSidebarResize() {
  const setSidebarWidth = useSidebarStore((s) => s.setSidebarWidth)
  const teardownRef = useRef<(() => void) | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (teardownRef.current) return

      const handle = e.currentTarget
      const pointerId = e.pointerId
      const sidebar = document.querySelector<HTMLElement>('.sidebar-container')
      const shell = document.querySelector<HTMLElement>('.sidebar-shell-outer')
      const target = shell ?? document.documentElement
      sidebar?.classList.add('is-resizing')
      document.documentElement.classList.add('sidebar-resizing')
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      handle.setPointerCapture?.(pointerId)

      let rafId: number | null = null
      let lastWidth: number | null = null

      const onPointerMove = (ev: PointerEvent) => {
        if (rafId !== null) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          const max = Math.max(SIDEBAR_WIDTH.MIN, window.innerWidth * SIDEBAR_WIDTH.MAX_PERCENTAGE)
          const clamped = Math.min(Math.max(ev.clientX, SIDEBAR_WIDTH.MIN), max)
          target.style.setProperty('--sidebar-width', `${clamped}px`)
          lastWidth = clamped
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
        teardownRef.current = null
      }

      function endDrag() {
        cleanup()
        if (lastWidth !== null) {
          setSidebarWidth(lastWidth)
          if (target !== document.documentElement) target.style.removeProperty('--sidebar-width')
        }
      }

      teardownRef.current = endDrag
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', endDrag)
      document.addEventListener('pointercancel', endDrag)
      window.addEventListener('blur', endDrag)
    },
    [setSidebarWidth]
  )

  useEffect(() => () => teardownRef.current?.(), [])

  return { handlePointerDown }
}
