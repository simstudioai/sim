import { useCallback, useEffect, useRef } from 'react'
import { OUTPUT_PANEL_WIDTH, TERMINAL_BLOCK_COLUMN_WIDTH } from '@/stores/constants'
import { useTerminalStore } from '@/stores/terminal'

/**
 * Handles the terminal output panel drag-resize with zero React renders
 * during the drag.
 *
 * Mirrors the sidebar resize architecture (`use-sidebar-resize.ts`):
 *
 * pointerdown  → capture the pointer on the handle (so move/up keep arriving
 *                even when the cursor leaves the window)
 * pointermove  → write to --output-panel-width inside a requestAnimationFrame
 *                callback (the CSS variable alone sizes the logs column via
 *                `calc(100% - var(--output-panel-width))`)
 * pointerup    → cancel any pending RAF, tear down, persist the final width
 *                to Zustand once (one re-render + one localStorage write)
 *
 * The drag is torn down by `pointerup`, `pointercancel`, or window `blur`, so
 * an interrupted gesture can never leave the drag listeners or body cursor
 * stuck. A single-flight guard prevents stacking listeners across rapid
 * presses, and an unmount cleanup tears down a drag still in flight.
 */
export function useOutputPanelResize() {
  const setOutputPanelWidth = useTerminalStore((s) => s.setOutputPanelWidth)
  const cleanupRef = useRef<(() => void) | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (cleanupRef.current) return

      const terminalEl = document.querySelector('[aria-label="Terminal"]')
      if (!terminalEl) return

      const handle = e.currentTarget
      const pointerId = e.pointerId
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      handle.setPointerCapture?.(pointerId)

      let rafId: number | null = null

      const onPointerMove = (ev: PointerEvent) => {
        if (rafId !== null) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          const terminalRect = terminalEl.getBoundingClientRect()
          const newWidth = terminalRect.right - ev.clientX
          const maxWidth = terminalRect.width - TERMINAL_BLOCK_COLUMN_WIDTH
          const clamped = Math.max(OUTPUT_PANEL_WIDTH.MIN, Math.min(newWidth, maxWidth))
          document.documentElement.style.setProperty('--output-panel-width', `${clamped}px`)
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
        const raw = document.documentElement.style.getPropertyValue('--output-panel-width')
        const finalWidth = Number.parseFloat(raw)
        if (!Number.isNaN(finalWidth)) setOutputPanelWidth(finalWidth)
      }

      cleanupRef.current = cleanup
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', endDrag)
      document.addEventListener('pointercancel', endDrag)
      window.addEventListener('blur', endDrag)
    },
    [setOutputPanelWidth]
  )

  useEffect(() => () => cleanupRef.current?.(), [])

  return { handlePointerDown }
}
