import { useCallback, useEffect, useRef } from 'react'
import { beginBrowserPanelDividerDrag } from '@/lib/browser-agent/transport'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

/**
 * Widest the panel may be laid out at, in CSS px.
 *
 * Two independent ceilings, and the tighter one wins: a viewport-share policy,
 * and the hard limit the chat column's own `min-width` imposes on the flex row.
 * Both have to be here, because a width written past either one does not render
 * — the row absorbs the difference silently, leaving the inline style reading a
 * value the panel is not actually at.
 *
 * Floored at MIN so a window too narrow to satisfy both keeps a usable panel
 * rather than collapsing it; below that the row overflows, which is the same
 * thing it did before and is only reachable at the minimum window size with the
 * sidebar expanded.
 */
export function maxPanelWidth(viewportWidth: number, containerWidth: number): number {
  return Math.max(
    MOTHERSHIP_WIDTH.MIN,
    Math.min(
      viewportWidth * MOTHERSHIP_WIDTH.MAX_PERCENTAGE,
      containerWidth - MOTHERSHIP_WIDTH.CHAT_MIN
    )
  )
}

function measureMaxWidth(el: HTMLElement): number {
  return maxPanelWidth(window.innerWidth, el.parentElement?.clientWidth ?? window.innerWidth)
}

/** What a divider drag measures once at pointerdown and holds for the gesture. */
export interface DragGeometry {
  /**
   * Viewport x of the panel's right edge. Measured, never assumed to be
   * `window.innerWidth` — the workspace chrome's padding and border inset the
   * panel from the viewport edge.
   */
  panelRight: number
  /** Where the pointer sat relative to the panel's left edge when grabbed. */
  grabOffset: number
  /** @see maxPanelWidth */
  maxWidth: number
}

/** Panel width for a pointer position. The only place the clamps live. */
export function panelWidthAt(clientX: number, geometry: DragGeometry): number {
  const { panelRight, grabOffset, maxWidth } = geometry
  return Math.max(MOTHERSHIP_WIDTH.MIN, Math.min(panelRight - (clientX - grabOffset), maxWidth))
}

/**
 * Viewport x the panel's left edge lands at for a pointer position, clamps
 * included.
 *
 * Defined in terms of {@link panelWidthAt} rather than from the pointer, so the
 * divider reported to the native browser view cannot describe a different edge
 * than the width write produces. Keeping these two derivations in one place is
 * the invariant — when they drifted apart the native view composited beside the
 * panel instead of on it, and alternated with the measured report every frame.
 */
export function dividerXAt(clientX: number, geometry: DragGeometry): number {
  return geometry.panelRight - panelWidthAt(clientX, geometry)
}

/**
 * Hook for managing resize of the MothershipView resource panel.
 *
 * Uses imperative DOM manipulation (zero React re-renders during drag) with
 * Pointer Events + setPointerCapture for unified mouse/touch/stylus support.
 * Attach `mothershipRef` to the MothershipView root div and bind
 * `handleResizePointerDown` to the drag handle's onPointerDown.
 * Call `clearWidth` when the panel collapses so the CSS class retakes control.
 */
export function useMothershipResize() {
  const mothershipRef = useRef<HTMLDivElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()

    const el = mothershipRef.current
    if (!el) return
    // Single-flight: a second press while a drag is live must not stack listeners
    if (cleanupRef.current) return

    const handle = e.currentTarget as HTMLElement
    const pointerId = e.pointerId
    handle.setPointerCapture(pointerId)

    // Pin to current rendered width so drag starts from the visual position
    const startRect = el.getBoundingClientRect()
    el.style.width = `${startRect.width}px`

    // Nothing moves the panel's right edge mid-drag, and the pointer keeps the
    // offset it grabbed at, so one measurement serves the whole gesture.
    const geometry: DragGeometry = {
      panelRight: startRect.right,
      grabOffset: e.clientX - startRect.left,
      maxWidth: measureMaxWidth(el),
    }

    // The panel's left edge IS the divider. Handing it to the browser
    // transport lets the native browser view (when one is showing) be
    // repositioned arithmetically per pointer move instead of waiting for the
    // renderer's layout → measure → report round-trip; no-op (null) when no
    // browser resource is live
    const predictBrowserBounds = beginBrowserPanelDividerDrag(startRect.left)

    // Disable CSS transition to prevent animation lag during drag
    const prevTransition = el.style.transition
    el.style.transition = 'none'
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    let rafId: number | null = null
    let lastClientX: number | null = null

    const applyWidth = (clientX: number) => {
      el.style.width = `${panelWidthAt(clientX, geometry)}px`
    }

    // AbortController removes all listeners at once on cleanup/cancel/unmount
    const ac = new AbortController()
    const { signal } = ac

    const cleanup = () => {
      ac.abort()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      // Land on the exact final pointer position before transitions come back,
      // so a fast flick whose last move never got a frame is not lost. The
      // flush is what stops that catch-up delta from animating: without it the
      // width write and the transition restore land in one style change, and
      // the panel eases into its final width over 200ms while the native view
      // chases it.
      if (lastClientX !== null) applyWidth(lastClientX)
      void el.offsetWidth
      el.style.transition = prevTransition
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      cleanupRef.current = null
    }
    cleanupRef.current = cleanup

    handle.addEventListener(
      'pointermove',
      (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        lastClientX = moveEvent.clientX
        // Fast path first: hand the native browser view its next rect at
        // pointer-event time (clamped exactly like the width write below), a
        // full layout pass ahead of the measured geometry report
        predictBrowserBounds?.(dividerXAt(moveEvent.clientX, geometry))
        // Coalesce to one width write per frame: pointermove can outpace the
        // display refresh, and every unbatched write forces an extra layout
        // pass that the embedded browser view then has to chase
        rafId ??= requestAnimationFrame(() => {
          rafId = null
          if (lastClientX !== null) applyWidth(lastClientX)
        })
      },
      { signal }
    )

    handle.addEventListener(
      'pointerup',
      (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return
        handle.releasePointerCapture(upEvent.pointerId)
        cleanup()
      },
      { signal }
    )

    // Browser fires pointercancel when it reclaims the gesture (scroll, palm rejection, etc.)
    // Without this, body cursor/userSelect and transition would be permanently stuck
    handle.addEventListener('pointercancel', cleanup, { signal })
    // A blur mid-drag (cmd-tab, window switch) would otherwise strand the
    // body cursor/userSelect overrides with no pointerup coming
    window.addEventListener('blur', cleanup, { signal })
  }, [])

  // Tear down any active drag if the component unmounts mid-drag
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  // Re-clamp panel width when the viewport is resized (inline px width can exceed max after narrowing).
  // Shares `measureMaxWidth` with the drag so a window resize can never leave
  // the panel at a width the drag would have refused, or vice versa.
  // Coalesced to one frame, and the pinned width is read off the inline style
  // rather than the box: resize events can outpace the display during a live
  // window-edge drag, so measuring in the handler would flush layout per event.
  // The container measurement `computeMaxWidth` does need costs one flush, but
  // it happens inside the coalesced frame, not per event.
  // The clamp also has to land without animating — the transition on the panel
  // would otherwise make the embedded browser view chase a moving rect for
  // 200ms after the drag stops.
  useEffect(() => {
    let rafId: number | null = null

    const clampWidth = () => {
      rafId = null
      const el = mothershipRef.current
      const pinned = el?.style.width
      if (!el || !pinned) return
      const maxWidth = measureMaxWidth(el)
      if (Number.parseFloat(pinned) <= maxWidth) return
      const prevTransition = el.style.transition
      el.style.transition = 'none'
      el.style.width = `${maxWidth}px`
      // Force the clamped width to be picked up before transitions come back,
      // so restoring the property cannot animate from the pre-clamp width.
      void el.offsetWidth
      el.style.transition = prevTransition
    }

    const handleWindowResize = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(clampWidth)
    }

    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.removeEventListener('resize', handleWindowResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  /** Remove inline width so the collapse CSS class retakes control */
  const clearWidth = useCallback(() => {
    mothershipRef.current?.style.removeProperty('width')
  }, [])

  return { mothershipRef, handleResizePointerDown, clearWidth }
}
