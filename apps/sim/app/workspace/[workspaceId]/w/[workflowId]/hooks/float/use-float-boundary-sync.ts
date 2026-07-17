import { useCallback, useEffect, useRef } from 'react'

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
 * Layout dimensions a float must stay clear of. During a resize drag the live
 * value is an inline override on the consuming element (a scoped style recalc);
 * at rest it lives on `:root` (committed via the store / pre-hydration script).
 * Each entry pairs the element the drag writes to with its variable so the
 * float tracks the drag live and re-clamps at rest.
 */
const BOUNDARY_DIMENSIONS = [
  { selector: '.sidebar-shell-outer', cssVar: '--sidebar-width' },
  { selector: '.panel-container', cssVar: '--panel-width' },
  { selector: '.terminal-container', cssVar: '--terminal-height' },
] as const

/** Reads a boundary dimension, preferring the drag's scoped inline override. */
function readBoundaryDimension(selector: string, cssVar: string): number {
  const inline = document.querySelector<HTMLElement>(selector)?.style.getPropertyValue(cssVar)
  const value = inline || getComputedStyle(document.documentElement).getPropertyValue(cssVar)
  return Number.parseInt(value || '0')
}

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
  const previousDimensionsRef = useRef({ sidebarWidth: 0, panelWidth: 0, terminalHeight: 0 })

  positionRef.current = position

  const checkAndUpdatePosition = useCallback(() => {
    const sidebarWidth = readBoundaryDimension('.sidebar-shell-outer', '--sidebar-width')
    const panelWidth = readBoundaryDimension('.panel-container', '--panel-width')
    const terminalHeight = readBoundaryDimension('.terminal-container', '--terminal-height')

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
    const maxX = window.innerWidth - CONTENT_WINDOW_GAP - panelWidth - width
    const minY = CONTENT_WINDOW_GAP
    const maxY = window.innerHeight - CONTENT_WINDOW_GAP - terminalHeight - height

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
    for (const { selector } of BOUNDARY_DIMENSIONS) {
      const el = document.querySelector(selector)
      if (el) observer.observe(el, { attributes: true, attributeFilter: ['style'] })
    }

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
