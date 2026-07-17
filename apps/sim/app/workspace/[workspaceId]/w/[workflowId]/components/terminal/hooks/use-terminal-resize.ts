import { TERMINAL_CONFIG } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/utils'
import { useDragResize } from '@/hooks/use-drag-resize'
import { CONTENT_WINDOW_GAP, TERMINAL_HEIGHT } from '@/stores/constants'
import { useTerminalStore } from '@/stores/terminal'

/** Computes the clamped terminal height for a pointer position */
function computeTerminalHeight(ev: PointerEvent): number {
  const maxHeight = Math.max(
    TERMINAL_HEIGHT.MIN,
    window.innerHeight * TERMINAL_HEIGHT.MAX_PERCENTAGE
  )
  const newHeight = window.innerHeight - CONTENT_WINDOW_GAP - ev.clientY
  return Math.min(Math.max(newHeight, TERMINAL_HEIGHT.MIN), maxHeight)
}

/**
 * Applies the terminal height per frame. The `--terminal-height` CSS
 * variable alone sizes `.terminal-container`, so no React work happens on
 * ordinary frames. The store is committed mid-drag only when the height
 * crosses the expanded threshold, so `isExpanded` subscribers (header
 * chevron, auto-open logic) still flip live during the drag.
 */
function applyTerminalHeight(height: number): void {
  document.documentElement.style.setProperty('--terminal-height', `${height}px`)

  const store = useTerminalStore.getState()
  const wasExpanded = store.terminalHeight > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD
  const nowExpanded = height > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD
  if (wasExpanded !== nowExpanded) store.setTerminalHeight(height)
}

/**
 * Handles terminal drag-resize with zero React renders during the drag
 * (except at expanded-threshold crossings). The final height is committed
 * to the store (one re-render + one localStorage write) when the drag ends.
 *
 * @returns Pointer-down handler for the resize handle
 */
export function useTerminalResize() {
  const setTerminalHeight = useTerminalStore((s) => s.setTerminalHeight)

  return useDragResize({
    cursor: 'ns-resize',
    compute: computeTerminalHeight,
    apply: applyTerminalHeight,
    commit: setTerminalHeight,
  })
}
