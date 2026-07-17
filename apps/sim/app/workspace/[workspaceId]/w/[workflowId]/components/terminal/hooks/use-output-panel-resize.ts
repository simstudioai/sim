import { useCallback, useRef } from 'react'
import { useDragResize } from '@/hooks/use-drag-resize'
import { OUTPUT_PANEL_WIDTH, TERMINAL_BLOCK_COLUMN_WIDTH } from '@/stores/constants'
import { useTerminalStore } from '@/stores/terminal'

/**
 * Applies the output panel width per frame. The `--output-panel-width` CSS
 * variable alone sizes the output panel and its sibling logs column, so no
 * React work happens during the drag.
 */
function applyOutputPanelWidth(width: number): void {
  document.documentElement.style.setProperty('--output-panel-width', `${width}px`)
}

/**
 * Handles the terminal output panel drag-resize with zero React renders
 * during the drag. The terminal rect is captured once on drag start (its
 * size cannot change mid-drag, and this keeps forced layout reads off the
 * per-move path). The final width is committed to the store (one re-render
 * + one localStorage write) when the drag ends.
 *
 * @returns Pointer-down handler for the resize handle
 */
export function useOutputPanelResize() {
  const setOutputPanelWidth = useTerminalStore((s) => s.setOutputPanelWidth)
  const terminalRectRef = useRef<DOMRect | null>(null)

  const captureTerminalRect = useCallback(() => {
    const terminalEl = document.querySelector('[aria-label="Terminal"]')
    if (!terminalEl) return false
    terminalRectRef.current = terminalEl.getBoundingClientRect()
    return true
  }, [])

  const computeOutputPanelWidth = useCallback((ev: PointerEvent) => {
    const terminalRect = terminalRectRef.current
    if (!terminalRect) return null
    const newWidth = terminalRect.right - ev.clientX
    const maxWidth = terminalRect.width - TERMINAL_BLOCK_COLUMN_WIDTH
    return Math.max(OUTPUT_PANEL_WIDTH.MIN, Math.min(newWidth, maxWidth))
  }, [])

  return useDragResize({
    cursor: 'ew-resize',
    compute: computeOutputPanelWidth,
    apply: applyOutputPanelWidth,
    commit: setOutputPanelWidth,
    onStart: captureTerminalRect,
  })
}
