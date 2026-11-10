import { useCallback, useEffect, useRef } from 'react'
import { getPanelWidth, getTerminalHeight } from '@/lib/workflows/layout'

interface UseFloatBoundarySyncProps {
  isOpen: boolean
  position: { x: number; y: number }
  width: number
  height: number
  onPositionChange: (position: { x: number; y: number }) => void
}

/** Inset gap between the viewport edge and the content window */
const CONTENT_WINDOW_GAP = 8

/**
 * Containers a resize drag writes its live dimension to as an inline style; at
 * rest the value lives on `:root`. Observing both keeps the float re-clamping
 * throughout a drag rather than only on release.
 */
const BOUNDARY_CONTAINER_SELECTORS = ['.panel-container', '.terminal-container'] as const

/**
 * Hook to synchronize a float's position with layout boundary changes.
 * Keeps the float within bounds when the sidebar, panel, or terminal resize.
 * Uses requestAnimationFrame for smooth real-time updates.
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
  const previousDimensionsRef = useRef({
    sidebarWidth: 0,
    panelWidth: 0,
    terminalHeight: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  })

  positionRef.current = position

  const checkAndUpdatePosition = useCallback(() => {
    const sidebarWidth = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
    )
    const panelWidth = getPanelWidth()
    const terminalHeight = getTerminalHeight()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const prev = previousDimensionsRef.current
    if (
      prev.sidebarWidth === sidebarWidth &&
      prev.panelWidth === panelWidth &&
      prev.terminalHeight === terminalHeight &&
      prev.viewportWidth === viewportWidth &&
      prev.viewportHeight === viewportHeight
    ) {
      return
    }

    previousDimensionsRef.current = {
      sidebarWidth,
      panelWidth,
      terminalHeight,
      viewportWidth,
      viewportHeight,
    }

    const minX = sidebarWidth
    const maxX = viewportWidth - CONTENT_WINDOW_GAP - panelWidth - width
    const minY = CONTENT_WINDOW_GAP
    const maxY = viewportHeight - CONTENT_WINDOW_GAP - terminalHeight - height

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

    /**
     * Watch both `:root` (at-rest commits, the pre-hydration script) and each
     * container the resize hooks write to mid-drag, so the float re-clamps live
     * throughout a drag rather than only on release.
     */
    const observer = new MutationObserver(handleResize)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    for (const selector of BOUNDARY_CONTAINER_SELECTORS) {
      const el = document.querySelector(selector)
      if (el) observer.observe(el, { attributes: true, attributeFilter: ['style'] })
    }

    const terminal = document.querySelector('.terminal-container')
    const resizeObserver = new ResizeObserver(handleResize)
    if (terminal) resizeObserver.observe(terminal)

    checkAndUpdatePosition()

    return () => {
      window.removeEventListener('resize', handleResize)
      observer.disconnect()
      resizeObserver.disconnect()
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [isOpen, checkAndUpdatePosition])
}
