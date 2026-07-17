import { useCallback, useEffect, useRef } from 'react'
import { PANEL_WIDTH } from '@/stores/constants'
import { usePanelStore } from '@/stores/panel'

/** Inset gap between the viewport edge and the content window */
const CONTENT_WINDOW_GAP = 8

/**
 * Handles panel drag-resize with zero React renders during the drag.
 *
 * Mirrors the sidebar resize architecture (`use-sidebar-resize.ts`):
 *
 * pointerdown  → capture the pointer on the handle (so move/up keep arriving
 *                even when the cursor leaves the window)
 * pointermove  → write to --panel-width inside a requestAnimationFrame
 *                callback (the CSS variable alone sizes `.panel-container`,
 *                so no React work happens per frame)
 * pointerup    → cancel any pending RAF, tear down, persist the final width
 *                to Zustand once (one re-render + one localStorage write)
 *
 * The drag is torn down by `pointerup`, `pointercancel`, or window `blur`, so
 * an interrupted gesture can never leave the drag listeners or body cursor
 * stuck. A single-flight guard prevents stacking listeners across rapid
 * presses, and an unmount cleanup tears down a drag still in flight.
 */
export function usePanelResize() {
  const setPanelWidth = usePanelStore((s) => s.setPanelWidth)
  const setIsResizing = usePanelStore((s) => s.setIsResizing)
  const cleanupRef = useRef<(() => void) | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (cleanupRef.current) return

      const handle = e.currentTarget
      const pointerId = e.pointerId
      setIsResizing(true)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      handle.setPointerCapture?.(pointerId)

      let rafId: number | null = null

      const onPointerMove = (ev: PointerEvent) => {
        if (rafId !== null) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          const maxWidth = window.innerWidth * PANEL_WIDTH.MAX_PERCENTAGE
          const newWidth = window.innerWidth - CONTENT_WINDOW_GAP - ev.clientX
          const clamped = Math.min(Math.max(newWidth, PANEL_WIDTH.MIN), maxWidth)
          document.documentElement.style.setProperty('--panel-width', `${clamped}px`)
          rafId = null
        })
      }

      const cleanup = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
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
        const raw = document.documentElement.style.getPropertyValue('--panel-width')
        const finalWidth = Number.parseFloat(raw)
        if (!Number.isNaN(finalWidth)) setPanelWidth(finalWidth)
        setIsResizing(false)
      }

      cleanupRef.current = cleanup
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', endDrag)
      document.addEventListener('pointercancel', endDrag)
      window.addEventListener('blur', endDrag)
    },
    [setPanelWidth, setIsResizing]
  )

  useEffect(() => () => cleanupRef.current?.(), [])

  return { handlePointerDown }
}
