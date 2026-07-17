import { useCallback, useEffect, useRef } from 'react'
import { TERMINAL_CONFIG } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/utils'
import { TERMINAL_HEIGHT } from '@/stores/constants'
import { useTerminalStore } from '@/stores/terminal'

/** Inset gap between the viewport edge and the content window */
const CONTENT_WINDOW_GAP = 8

/**
 * Handles terminal drag-resize with (almost) zero React renders during the drag.
 *
 * Mirrors the sidebar resize architecture (`use-sidebar-resize.ts`):
 *
 * pointerdown  → capture the pointer on the handle (so move/up keep arriving
 *                even when the cursor leaves the window)
 * pointermove  → write to --terminal-height inside a requestAnimationFrame
 *                callback (the CSS variable alone sizes `.terminal-container`).
 *                The store is committed mid-drag only when the height crosses
 *                the expanded threshold, so `isExpanded` subscribers (header
 *                chevron, auto-open logic) still flip live.
 * pointerup    → cancel any pending RAF, tear down, persist the final height
 *                to Zustand once (one re-render + one localStorage write)
 *
 * The drag is torn down by `pointerup`, `pointercancel`, or window `blur`, so
 * an interrupted gesture can never leave the drag listeners or body cursor
 * stuck. A single-flight guard prevents stacking listeners across rapid
 * presses, and an unmount cleanup tears down a drag still in flight.
 */
export function useTerminalResize() {
  const setTerminalHeight = useTerminalStore((s) => s.setTerminalHeight)
  const setIsResizing = useTerminalStore((s) => s.setIsResizing)
  const cleanupRef = useRef<(() => void) | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (cleanupRef.current) return

      const handle = e.currentTarget
      const pointerId = e.pointerId
      setIsResizing(true)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
      handle.setPointerCapture?.(pointerId)

      let rafId: number | null = null

      const onPointerMove = (ev: PointerEvent) => {
        if (rafId !== null) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          const maxHeight = window.innerHeight * TERMINAL_HEIGHT.MAX_PERCENTAGE
          const newHeight = window.innerHeight - CONTENT_WINDOW_GAP - ev.clientY
          const clamped = Math.min(Math.max(newHeight, TERMINAL_HEIGHT.MIN), maxHeight)
          document.documentElement.style.setProperty('--terminal-height', `${clamped}px`)

          const wasExpanded =
            useTerminalStore.getState().terminalHeight > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD
          const nowExpanded = clamped > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD
          if (wasExpanded !== nowExpanded) setTerminalHeight(clamped)

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
        const raw = document.documentElement.style.getPropertyValue('--terminal-height')
        const finalHeight = Number.parseFloat(raw)
        if (!Number.isNaN(finalHeight)) setTerminalHeight(finalHeight)
        setIsResizing(false)
      }

      cleanupRef.current = cleanup
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', endDrag)
      document.addEventListener('pointercancel', endDrag)
      window.addEventListener('blur', endDrag)
    },
    [setTerminalHeight, setIsResizing]
  )

  useEffect(() => () => cleanupRef.current?.(), [])

  return { handlePointerDown }
}
