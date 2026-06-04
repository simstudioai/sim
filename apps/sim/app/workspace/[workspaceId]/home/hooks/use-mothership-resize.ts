import { useCallback, useEffect, useRef } from 'react'
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

    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)

    // Pin to current rendered width so drag starts from the visual position
    el.style.width = `${el.getBoundingClientRect().width}px`

    // Disable CSS transition to prevent animation lag during drag
    const prevTransition = el.style.transition
    el.style.transition = 'none'
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    // AbortController removes all listeners at once on cleanup/cancel/unmount
    const ac = new AbortController()
    const { signal } = ac

    const cleanup = () => {
      ac.abort()
      el.style.transition = prevTransition
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      cleanupRef.current = null
    }
    cleanupRef.current = cleanup

    handle.addEventListener(
      'pointermove',
      (moveEvent: PointerEvent) => {
        const newWidth = window.innerWidth - moveEvent.clientX
        const maxWidth = window.innerWidth * MOTHERSHIP_WIDTH.MAX_PERCENTAGE
        el.style.width = `${Math.min(Math.max(newWidth, MOTHERSHIP_WIDTH.MIN), maxWidth)}px`
      },
      { signal }
    )

    handle.addEventListener(
      'pointerup',
      (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId)
        cleanup()
      },
      { signal }
    )

    // Browser fires pointercancel when it reclaims the gesture (scroll, palm rejection, etc.)
    // Without this, body cursor/userSelect and transition would be permanently stuck
    handle.addEventListener('pointercancel', cleanup, { signal })
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
