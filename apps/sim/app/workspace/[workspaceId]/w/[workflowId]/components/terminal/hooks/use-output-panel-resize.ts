import { useCallback, useRef } from 'react'
import { useDragResize } from '@/hooks/use-drag-resize'
import { OUTPUT_PANEL_WIDTH, TERMINAL_BLOCK_COLUMN_WIDTH } from '@/stores/constants'
import { useTerminalStore } from '@/stores/terminal'

/**
 * Handles the terminal output panel drag-resize with zero React renders
 * during the drag. `--output-panel-width` is written to `.terminal-container`
 * (which both the output panel and its sibling logs column inherit from) — a
 * scoped style recalc rather than a whole-document one on `:root`. The
 * terminal rect is re-read per frame (rAF-aligned, before the write), so the
 * clamp stays correct even if the terminal resizes mid-drag. The final width
 * is committed to the store (one re-render + one localStorage write) when the
 * drag ends.
 *
 * @returns Pointer-down handler for the resize handle
 */
export function useOutputPanelResize() {
  const setOutputPanelWidth = useTerminalStore((s) => s.setOutputPanelWidth)
  const terminalElRef = useRef<HTMLElement | null>(null)

  const getTerminalElement = useCallback(() => {
    terminalElRef.current = document.querySelector<HTMLElement>('.terminal-container')
    return terminalElRef.current
  }, [])

  const computeOutputPanelWidth = useCallback((ev: PointerEvent) => {
    const terminalEl = terminalElRef.current
    if (!terminalEl) return null
    const terminalRect = terminalEl.getBoundingClientRect()
    const newWidth = terminalRect.right - ev.clientX
    const maxWidth = terminalRect.width - TERMINAL_BLOCK_COLUMN_WIDTH
    return Math.max(OUTPUT_PANEL_WIDTH.MIN, Math.min(newWidth, maxWidth))
  }, [])

  return useDragResize({
    cursor: 'ew-resize',
    cssVar: '--output-panel-width',
    getTarget: getTerminalElement,
    compute: computeOutputPanelWidth,
    commit: setOutputPanelWidth,
  })
}
