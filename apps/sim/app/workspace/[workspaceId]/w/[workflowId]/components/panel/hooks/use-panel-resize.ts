import { type KeyboardEvent, useEffect, useState } from 'react'
import { useDragResize } from '@/hooks/use-drag-resize'
import { PANEL_WIDTH } from '@/stores/constants'
import { usePanelStore } from '@/stores/panel'

const PANEL_RESIZE_STEP = 16

function getPanelMaxWidth(): number {
  return Math.max(PANEL_WIDTH.MIN, window.innerWidth * PANEL_WIDTH.MAX_PERCENTAGE)
}

function clampPanelWidth(width: number, maxWidth: number): number {
  return Math.min(Math.max(width, PANEL_WIDTH.MIN), maxWidth)
}

/**
 * Computes the clamped panel width for a pointer position. The maximum is
 * floored at the minimum so a narrow viewport can never invert the clamp
 * and force the panel below {@link PANEL_WIDTH.MIN}.
 */
function computePanelWidth(ev: PointerEvent): number {
  const maxWidth = getPanelMaxWidth()
  const panelRight =
    document.querySelector<HTMLElement>('.panel-container')?.getBoundingClientRect().right ??
    window.innerWidth
  const newWidth = panelRight - ev.clientX
  return clampPanelWidth(newWidth, maxWidth)
}

/** The docked canvas shell and panel both size themselves from `--panel-width`. */
function getPanelResizeTarget(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.workflow-canvas-shell')
}

/**
 * The toast stack also insets its right edge by `--panel-width`, but is
 * portalled to `<body>` and so shares no ancestor with the panel. See
 * `use-terminal-resize.ts` for why this is written alongside the primary.
 */
function getToastViewport(): (HTMLElement | null)[] {
  return [document.querySelector<HTMLElement>('[data-toast-viewport]')]
}

/**
 * Handles panel drag-resize with zero React renders during the drag. The
 * `--panel-width` variable is written to `.workflow-canvas-shell` (a scoped style
 * recalc shared by the canvas and panel) rather than `:root`, and the final width
 * is committed to the store (one re-render + one localStorage write) when the
 * drag ends.
 *
 * @returns Pointer-down handler for the resize handle
 */
export function usePanelResize() {
  const panelWidth = usePanelStore((s) => s.panelWidth)
  const setPanelWidth = usePanelStore((s) => s.setPanelWidth)
  const [maxPanelWidth, setMaxPanelWidth] = useState<number | null>(null)

  useEffect(() => {
    const updateMaxPanelWidth = () => {
      const nextMaxPanelWidth = getPanelMaxWidth()
      setMaxPanelWidth(nextMaxPanelWidth)

      const currentWidth = usePanelStore.getState().panelWidth
      if (currentWidth > nextMaxPanelWidth) {
        setPanelWidth(nextMaxPanelWidth)
      }
    }

    updateMaxPanelWidth()
    window.addEventListener('resize', updateMaxPanelWidth)
    return () => window.removeEventListener('resize', updateMaxPanelWidth)
  }, [setPanelWidth])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const currentMaxPanelWidth = maxPanelWidth ?? getPanelMaxWidth()
    let nextWidth: number

    switch (event.key) {
      case 'ArrowLeft':
        nextWidth = panelWidth + PANEL_RESIZE_STEP
        break
      case 'ArrowRight':
        nextWidth = panelWidth - PANEL_RESIZE_STEP
        break
      case 'Home':
        nextWidth = PANEL_WIDTH.MIN
        break
      case 'End':
        nextWidth = currentMaxPanelWidth
        break
      default:
        return
    }

    event.preventDefault()
    setPanelWidth(clampPanelWidth(nextWidth, currentMaxPanelWidth))
  }

  const { handlePointerDown } = useDragResize({
    cursor: 'ew-resize',
    cssVar: '--panel-width',
    getTarget: getPanelResizeTarget,
    getExtraTargets: getToastViewport,
    compute: computePanelWidth,
    commit: setPanelWidth,
  })

  return { handleKeyDown, handlePointerDown, maxPanelWidth, panelWidth }
}
