import { useCallback, useEffect, useRef } from 'react'

interface UseFloatBoundarySyncProps {
  isOpen: boolean
  position: { x: number; y: number }
  width: number
  height: number
  onPositionChange: (position: { x: number; y: number }) => void
}

/**
 * Hook to synchronize floats position with layout boundary changes.
 * Keeps the float within bounds when sidebar, panel, or terminal resize.
 * Uses requestAnimationFrame for smooth real-time updates
 */
export function useFloatBoundarySync({
  isOpen,
  position,
  width,
  height,
  onPositionChange,
}: UseFloatBoundarySyncProps) {
  const rafIdRef = useRef<number | null>(null)
  const positionRef = useRef(position)
  const previousDimensionsRef = useRef({ sidebarWidth: 0, panelWidth: 0, terminalHeight: 0 })

  positionRef.current = position

  const checkAndUpdatePosition = useCallback(() => {
    const sidebarWidth = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
    )
    const panelWidth = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
    )
    const terminalHeight = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
    )

    const prev = previousDimensionsRef.current
    if (
      prev.sidebarWidth === sidebarWidth &&
      prev.panelWidth === panelWidth &&
      prev.terminalHeight === terminalHeight
    ) {
      return
    }

    previousDimensionsRef.current = { sidebarWidth, panelWidth, terminalHeight }

    const minX = sidebarWidth
    const maxX = window.innerWidth - panelWidth - width
    const minY = 0
    const maxY = window.innerHeight - terminalHeight - height

    const currentPos = positionRef.current

    if (currentPos.x < minX || currentPos.x > maxX || currentPos.y < minY || currentPos.y > maxY) {
      const newPosition = {
        x: Math.max(minX, Math.min(maxX, currentPos.x)),
        y: Math.max(minY, Math.min(maxY, currentPos.y)),
      }
      onPositionChange(newPosition)
    }
  }, [width, height, onPositionChange])

  useEffect(() => {
    if (!isOpen) return

    const handleResize = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }

      rafIdRef.current = requestAnimationFrame(() => {
        checkAndUpdatePosition()
        rafIdRef.current = null
      })
    }

    window.addEventListener('resize', handleResize)

    const observer = new MutationObserver(handleResize)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })

    checkAndUpdatePosition()

    return () => {
      window.removeEventListener('resize', handleResize)
      observer.disconnect()
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [isOpen, checkAndUpdatePosition])
}
