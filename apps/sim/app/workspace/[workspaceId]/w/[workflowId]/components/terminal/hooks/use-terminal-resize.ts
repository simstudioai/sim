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

/** The `.terminal-container` element sizes itself from `--terminal-height`. */
function getTerminalContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.terminal-container')
}

/**
 * Updates the store height mid-drag only when it crosses the expanded
 * threshold, so `isExpanded` subscribers (header chevron, auto-open logic)
 * still flip live during the drag. Writes store state directly rather than
 * calling `setTerminalHeight` so it does not also write `--terminal-height` to
 * `:root` (a whole-document recalc) — the scoped CSS-var write handled by
 * {@link useDragResize} already drives the visual, and the final value is
 * persisted through `setTerminalHeight` on release.
 */
function syncExpandedThreshold(height: number): void {
  const wasExpanded =
    useTerminalStore.getState().terminalHeight > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD
  const nowExpanded = height > TERMINAL_CONFIG.NEAR_MIN_THRESHOLD
  if (wasExpanded !== nowExpanded) useTerminalStore.setState({ terminalHeight: height })
}

/**
 * Handles terminal drag-resize with zero React renders during the drag
 * (except at expanded-threshold crossings). The `--terminal-height` variable
 * is written to `.terminal-container` (a scoped style recalc) rather than
 * `:root` (a whole-document recalc), and the final height is committed to the
 * store (one re-render + one localStorage write) when the drag ends.
 *
 * @returns Pointer-down handler for the resize handle
 */
export function useTerminalResize() {
  const setTerminalHeight = useTerminalStore((s) => s.setTerminalHeight)

  return useDragResize({
    cursor: 'ns-resize',
    cssVar: '--terminal-height',
    getTarget: getTerminalContainer,
    compute: computeTerminalHeight,
    commit: setTerminalHeight,
    onApply: syncExpandedThreshold,
  })
}
