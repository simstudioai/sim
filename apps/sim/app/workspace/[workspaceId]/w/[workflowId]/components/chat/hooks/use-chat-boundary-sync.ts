import { useCallback, useEffect, useRef } from 'react'

interface UseChatBoundarySyncProps {
  isOpen: boolean
  position: { x: number; y: number }
  width: number
  height: number
  onPositionChange: (position: { x: number; y: number }) => void
}

/**
 * Hook to synchronize chat position with layout boundary changes
 * Keeps chat within bounds when sidebar, panel, or terminal resize
 * Uses requestAnimationFrame for smooth real-time updates
 */
export function useChatBoundarySync({
  isOpen,
  position,
  width,
  height,
  onPositionChange,
}: UseChatBoundarySyncProps) {
  const rafIdRef = useRef<number | null>(null)
  const positionRef = useRef(position)
  const previousDimensionsRef = useRef({ sidebarWidth: 0, panelWidth: 0, terminalHeight: 0 })

  // Keep position ref up to date
  positionRef.current = position

  const checkAndUpdatePosition = useCallback(() => {
    // Get current layout dimensions
    const sidebarWidth = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
    )
    const panelWidth = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
    )
    const terminalHeight = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
    )

    // Check if dimensions actually changed
    const prev = previousDimensionsRef.current
    if (
      prev.sidebarWidth === sidebarWidth &&
      prev.panelWidth === panelWidth &&
      prev.terminalHeight === terminalHeight
    ) {
      return // No change, skip update
    }

    // Update previous dimensions
    previousDimensionsRef.current = { sidebarWidth, panelWidth, terminalHeight }

    // Calculate bounds
    const minX = sidebarWidth
    const maxX = window.innerWidth - panelWidth - width
    const minY = 0
    const maxY = window.innerHeight - terminalHeight - height

    const currentPos = positionRef.current

    // Check if current position is out of bounds
    if (currentPos.x < minX || currentPos.x > maxX || currentPos.y < minY || currentPos.y > maxY) {
      // Constrain to new bounds
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
      // Cancel any pending animation frame
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }

      // Schedule update on next animation frame for smooth 60fps updates
      rafIdRef.current = requestAnimationFrame(() => {
        checkAndUpdatePosition()
        rafIdRef.current = null
      })
    }

    // Listen for window resize
    window.addEventListener('resize', handleResize)

    // Create MutationObserver to watch for CSS variable changes
    // This fires immediately when sidebar/panel/terminal resize
    const observer = new MutationObserver(handleResize)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })

    // Initial check
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
