import { type RefObject, useLayoutEffect, useRef } from 'react'
import { autoUpdate, computePosition, flip, offset, type Placement, shift } from '@floating-ui/dom'

/** The `[data-emcn]` surface a canvas popup portals into, so it takes the Platform theme. */
export function floatingContainer(anchor: Element): HTMLElement {
  return anchor.closest<HTMLElement>('[data-emcn]') ?? anchor.ownerDocument.body
}

/**
 * The event EMCN tooltips broadcast as one opens, so only one tooltip shows at a time. Canvas
 * popups send and honor the same event.
 */
export const FLOATING_OPEN_EVENT = 'sim-emcn-tooltip-open'

interface FloatingPositionOptions {
  placement: Placement
  /** Gap between the anchor and the popup, in px (negative overlaps the anchor). */
  gap?: number
  /** Viewport clearance the popup keeps when it shifts or flips. */
  padding?: number
  /** Called when the anchor leaves the document (its block was removed while hovered). */
  onAnchorLost: () => void
}

/**
 * Keeps a fixed-position popup beside its anchor as the canvas pans, zooms or scrolls, the way EMCN
 * places its tooltips: Floating UI with flip and shift, revealed once the first position lands.
 */
export function useFloatingPosition(
  anchor: HTMLElement | null,
  floating: RefObject<HTMLElement | null>,
  { placement, gap = 0, padding = 0, onAnchorLost }: FloatingPositionOptions
) {
  const onAnchorLostRef = useRef(onAnchorLost)
  onAnchorLostRef.current = onAnchorLost

  useLayoutEffect(() => {
    const popup = floating.current
    if (!anchor || !popup) return
    let active = true
    const stop = autoUpdate(anchor, popup, async () => {
      if (!anchor.isConnected) {
        onAnchorLostRef.current()
        return
      }
      const { x, y } = await computePosition(anchor, popup, {
        strategy: 'fixed',
        placement,
        middleware: [offset(gap), flip({ padding }), shift({ padding })],
      })
      if (!active) return
      popup.style.left = `${x}px`
      popup.style.top = `${y}px`
      popup.dataset.positioned = ''
    })
    return () => {
      active = false
      stop()
    }
  }, [anchor, floating, placement, gap, padding])
}
