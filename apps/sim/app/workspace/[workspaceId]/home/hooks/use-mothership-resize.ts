import { useCallback, useEffect, useRef } from 'react'
import { MOTHERSHIP_WIDTH } from '@/stores/constants'

/**
 * Hook for managing resize of the MothershipView resource panel.
 *
 * Uses imperative DOM manipulation (zero React re-renders during drag).
 * Attach `mothershipRef` to the MothershipView root div and call
 * `handleResizeMouseDown` from the drag handle's onMouseDown.
 * Call `clearWidth` when the panel collapses so the CSS class retakes control.
 */
export function useMothershipResize() {
  const mothershipRef = useRef<HTMLDivElement | null>(null)
  // Stored so the useEffect cleanup can tear down listeners if the component unmounts mid-drag
  const cleanupRef = useRef<(() => void) | null>(null)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()

    const el = mothershipRef.current
    if (!el) return

    // Pin to current rendered width so drag starts from the visual position
    el.style.width = `${el.getBoundingClientRect().width}px`

    // Disable CSS transition to prevent animation lag during drag
    const prevTransition = el.style.transition
    el.style.transition = 'none'
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = window.innerWidth - moveEvent.clientX
      const maxWidth = window.innerWidth * MOTHERSHIP_WIDTH.MAX_PERCENTAGE
      el.style.width = `${Math.min(Math.max(newWidth, MOTHERSHIP_WIDTH.MIN), maxWidth)}px`
    }

    const handleMouseUp = () => {
      el.style.transition = prevTransition
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      cleanupRef.current = null
    }

    cleanupRef.current = handleMouseUp
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  // Tear down any active drag if the component unmounts mid-drag
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  /** Remove inline width so the collapse CSS class retakes control */
  const clearWidth = useCallback(() => {
    mothershipRef.current?.style.removeProperty('width')
  }, [])

  return { mothershipRef, handleResizeMouseDown, clearWidth }
}
