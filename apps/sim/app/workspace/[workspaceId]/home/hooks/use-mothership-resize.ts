import { useCallback, useEffect, useRef } from 'react'
import { beginBrowserPanelDividerDrag } from '@/lib/browser-agent/transport'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

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

    const computeWidth = (clientX: number) => {
      const maxWidth = window.innerWidth * MOTHERSHIP_WIDTH.MAX_PERCENTAGE
      return Math.min(Math.max(window.innerWidth - clientX, MOTHERSHIP_WIDTH.MIN), maxWidth)
    }

    const applyWidth = (clientX: number) => {
      el.style.width = `${computeWidth(clientX)}px`
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
      // Land on the exact final pointer position before transitions come back:
      // a fast flick whose last move never got a frame is not lost, and the
      // write can't animate
      if (lastClientX !== null) applyWidth(lastClientX)
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
        predictBrowserBounds?.(window.innerWidth - computeWidth(moveEvent.clientX))
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

  // Re-clamp panel width when the viewport is resized (inline px width can exceed max after narrowing)
  useEffect(() => {
    const handleWindowResize = () => {
      const el = mothershipRef.current
      if (!el || !el.style.width) return
      const maxWidth = window.innerWidth * MOTHERSHIP_WIDTH.MAX_PERCENTAGE
      const current = el.getBoundingClientRect().width
      if (current > maxWidth) {
        el.style.width = `${maxWidth}px`
      }
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  /** Remove inline width so the collapse CSS class retakes control */
  const clearWidth = useCallback(() => {
    mothershipRef.current?.style.removeProperty('width')
  }, [])

  return { mothershipRef, handleResizePointerDown, clearWidth }
}
