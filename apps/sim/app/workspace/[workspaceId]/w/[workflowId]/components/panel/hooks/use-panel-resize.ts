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
 * Every subtree that reads `--panel-width`: the `.panel-container` the drag
 * resizes, and the toast stack, which insets its right edge by the same
 * variable but is portalled to `<body>` and so shares no ancestor with it.
 * Writing both keeps the notifications tracking the drag frame by frame instead
 * of jumping once it commits.
 */
function getPanelWidthConsumers(): (HTMLElement | null)[] {
  return [
    document.querySelector<HTMLElement>('.panel-container'),
    document.querySelector<HTMLElement>('[data-toast-viewport]'),
  ]
}

/**
 * Handles panel drag-resize with zero React renders during the drag. The
 * `--panel-width` variable is written to `.panel-container` (a scoped style
 * recalc) rather than `:root` (a whole-document recalc), and the final width
 * is committed to the store (one re-render + one localStorage write) when the
 * drag ends.
 *
 * @returns Pointer-down handler for the resize handle
 */
export function usePanelResize() {
  const setPanelWidth = usePanelStore((s) => s.setPanelWidth)

  return useDragResize({
    cursor: 'ew-resize',
    cssVar: '--panel-width',
    getTarget: getPanelWidthConsumers,
    compute: computePanelWidth,
    commit: setPanelWidth,
  })
}
