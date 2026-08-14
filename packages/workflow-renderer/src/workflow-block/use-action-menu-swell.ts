import { type FocusEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'

const ACTION_MENU_FALLBACK_WIDTH_PX = 132
const ACTION_MENU_CLOSE_RETRACT_DELAY_MS = 40
const ACTION_MENU_HOVER_LEAVE_DELAY_MS = 100
const ACTION_MENU_HOVER_TOP_PAD_PX = 28

interface UseActionMenuSwellProps {
  enabled: boolean
  forceOpen: boolean
  maxWidth?: number
  /** Ignore stale hover and focus while an external state, such as execution, owns the swell. */
  suspendInteraction?: boolean
  /** Give nested React Flow nodes exclusive hover ownership over their own action menus. */
  suppressNestedNodeHover?: boolean
}

/**
 * Keeps the action-menu silhouette, its measured icon row, and hover/focus
 * state synchronized for every workflow node shape that uses the shared border.
 */
export function useActionMenuSwell({
  enabled,
  forceOpen,
  maxWidth,
  suspendInteraction = false,
  suppressNestedNodeHover = false,
}: UseActionMenuSwellProps) {
  const [isFocused, setIsFocused] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const hoverLeaveTimeoutRef = useRef<number | null>(null)
  const hoverMoveRef = useRef<((event: PointerEvent) => void) | null>(null)
  const [width, setWidth] = useState(ACTION_MENU_FALLBACK_WIDTH_PX)
  const [isReady, setIsReady] = useState(false)
  const keepOpen = isFocused || isHovered || forceOpen
  const contentVisible = keepOpen && isReady
  const [swellOpen, setSwellOpen] = useState(keepOpen)

  useEffect(() => {
    if (!suspendInteraction) return
    setIsFocused(false)
    setIsHovered(false)
  }, [suspendInteraction])

  useEffect(() => {
    if (keepOpen) {
      setSwellOpen(true)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSwellOpen(false)
    }, ACTION_MENU_CLOSE_RETRACT_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [keepOpen])

  useEffect(() => {
    if (!enabled || suspendInteraction) return

    const cancelHoverLeaveTimeout = () => {
      if (hoverLeaveTimeoutRef.current !== null) {
        window.clearTimeout(hoverLeaveTimeoutRef.current)
        hoverLeaveTimeoutRef.current = null
      }
    }

    const clearHoverLeave = () => {
      cancelHoverLeaveTimeout()
      if (hoverMoveRef.current) {
        window.removeEventListener('pointermove', hoverMoveRef.current)
        hoverMoveRef.current = null
      }
    }

    const root = rootRef.current
    const nodeElement = root?.closest<HTMLElement>('.react-flow__node') ?? root
    if (!nodeElement) return

    const isOtherNodeTarget = (target: EventTarget | null) => {
      if (!suppressNestedNodeHover || !(target instanceof Element)) return false
      const hoveredNode = target.closest('.react-flow__node')
      return Boolean(hoveredNode && hoveredNode !== nodeElement)
    }

    const isPointerOverActionMenu = (event: PointerEvent) => {
      if (!root || isOtherNodeTarget(event.target)) return false
      const rect = root.getBoundingClientRect()
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top - ACTION_MENU_HOVER_TOP_PAD_PX &&
        event.clientY <= rect.bottom
      )
    }

    const openHover = () => {
      clearHoverLeave()
      setIsHovered(true)
      setSwellOpen(true)
    }

    const closeHoverImmediately = () => {
      clearHoverLeave()
      setIsHovered(false)
      setSwellOpen(false)
    }

    const syncHoverOwner = (event: PointerEvent) => {
      if (isOtherNodeTarget(event.target)) {
        closeHoverImmediately()
        return
      }
      openHover()
    }

    /**
     * Arms the retract timer, unless one is already counting down. Never
     * touches the tracking listener: once the pointer has left the node, that
     * listener is the only thing still watching it, so tearing it down here
     * would strand the menu open with nothing left to close it.
     */
    const armHoverLeave = () => {
      if (hoverLeaveTimeoutRef.current !== null) return
      hoverLeaveTimeoutRef.current = window.setTimeout(() => {
        hoverLeaveTimeoutRef.current = null
        if (hoverMoveRef.current) {
          window.removeEventListener('pointermove', hoverMoveRef.current)
          hoverMoveRef.current = null
        }
        setIsHovered(false)
      }, ACTION_MENU_HOVER_LEAVE_DELAY_MS)
    }

    const scheduleHoverLeave = (event: PointerEvent) => {
      if (isOtherNodeTarget(event.relatedTarget)) {
        closeHoverImmediately()
        return
      }
      if (!hoverMoveRef.current) {
        /*
         * The bar floats above the card, so the pointer crosses a gap to reach
         * it and the card's own `pointerleave` fires on the way. This tracks
         * the pointer across that gap: inside the bar's hover band the retract
         * is cancelled, outside it is re-armed. Both directions matter — no
         * further `pointerleave` can arrive once the pointer is off the node,
         * so re-arming here is the only way the menu ever closes again.
         */
        const onMove = (moveEvent: PointerEvent) => {
          if (isOtherNodeTarget(moveEvent.target)) {
            closeHoverImmediately()
            return
          }
          if (isPointerOverActionMenu(moveEvent)) {
            cancelHoverLeaveTimeout()
            setIsHovered(true)
            setSwellOpen(true)
            return
          }
          armHoverLeave()
        }
        hoverMoveRef.current = onMove
        window.addEventListener('pointermove', onMove, { passive: true })
      }
      cancelHoverLeaveTimeout()
      armHoverLeave()
    }

    /*
     * A stationary pointer fires no `pointerenter`, so re-subscribing while it
     * already rests on the card (the listeners are torn down for the duration
     * of a run) would otherwise leave the menu collapsed until the user moved
     * off the node and back on.
     *
     * Nested nodes need no special case: React Flow renders every node as a
     * flat sibling under `.react-flow__nodes`, so a container is never a DOM
     * ancestor of the blocks inside it and `:hover` cannot leak upward.
     */
    if (nodeElement.matches(':hover')) openHover()

    nodeElement.addEventListener('pointerenter', openHover)
    nodeElement.addEventListener('pointerleave', scheduleHoverLeave)
    if (suppressNestedNodeHover) {
      nodeElement.addEventListener('pointerover', syncHoverOwner)
    }

    return () => {
      clearHoverLeave()
      nodeElement.removeEventListener('pointerenter', openHover)
      nodeElement.removeEventListener('pointerleave', scheduleHoverLeave)
      nodeElement.removeEventListener('pointerover', syncHoverOwner)
    }
  }, [enabled, suppressNestedNodeHover, suspendInteraction])

  useLayoutEffect(() => {
    if (!enabled) return

    const actionMenu = hostRef.current?.querySelector<HTMLElement>(
      '[data-workflow-action-bar-swell]'
    )
    if (!actionMenu) return

    const updateWidth = () => {
      const nextWidth = Math.min(maxWidth ?? Number.POSITIVE_INFINITY, actionMenu.offsetWidth)
      if (nextWidth <= 0) return
      setWidth((current) => (current === nextWidth ? current : nextWidth))
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(actionMenu)
    return () => observer.disconnect()
  }, [enabled, maxWidth])

  const onFocusCapture = () => {
    if (!suspendInteraction) setIsFocused(true)
  }
  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsFocused(false)
    }
  }

  return {
    rootRef,
    hostRef,
    width,
    swellOpen,
    contentVisible,
    setReady: setIsReady,
    onFocusCapture,
    onBlurCapture,
  }
}
