import { useDragResize } from '@/hooks/use-drag-resize'
import { CONTENT_WINDOW_GAP, PANEL_WIDTH } from '@/stores/constants'
import { usePanelStore } from '@/stores/panel'

/**
 * Computes the clamped panel width for a pointer position. The maximum is
 * floored at the minimum so a narrow viewport can never invert the clamp
 * and force the panel below {@link PANEL_WIDTH.MIN}.
 */
function computePanelWidth(ev: PointerEvent): number {
  const maxWidth = Math.max(PANEL_WIDTH.MIN, window.innerWidth * PANEL_WIDTH.MAX_PERCENTAGE)
  const newWidth = window.innerWidth - CONTENT_WINDOW_GAP - ev.clientX
  return Math.min(Math.max(newWidth, PANEL_WIDTH.MIN), maxWidth)
}

/**
 * Applies the panel width per frame. The `--panel-width` CSS variable alone
 * sizes `.panel-container`, so no React work happens during the drag.
 */
function applyPanelWidth(width: number): void {
  document.documentElement.style.setProperty('--panel-width', `${width}px`)
}

/**
 * Handles panel drag-resize with zero React renders during the drag.
 * The final width is committed to the store (one re-render + one
 * localStorage write) when the drag ends.
 *
 * @returns Pointer-down handler for the resize handle
 */
export function usePanelResize() {
  const setPanelWidth = usePanelStore((s) => s.setPanelWidth)

  return useDragResize({
    cursor: 'ew-resize',
    compute: computePanelWidth,
    apply: applyPanelWidth,
    commit: setPanelWidth,
  })
}
