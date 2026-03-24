import { useCallback, useMemo } from 'react'
import type { Node, ReactFlowInstance } from 'reactflow'
import { BLOCK_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'

interface VisibleBounds {
  width: number
  height: number
  offsetLeft: number
  offsetRight: number
  offsetBottom: number
}

export interface CanvasViewportOptions {
  embedded?: boolean
}

/**
 * Gets the visible canvas bounds accounting for sidebar, terminal, and panel overlays.
 * When embedded, uses the container rect directly since CSS variable offsets don't apply.
 */
function getVisibleCanvasBounds(options?: CanvasViewportOptions): VisibleBounds {
  const flowContainer = document.querySelector('.react-flow')

  if (options?.embedded && flowContainer) {
    const rect = flowContainer.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
      offsetLeft: 0,
      offsetRight: 0,
      offsetBottom: 0,
    }
  }

  const style = getComputedStyle(document.documentElement)

  const sidebarWidth = Number.parseInt(style.getPropertyValue('--sidebar-width') || '0', 10)
  const terminalHeight = Number.parseInt(style.getPropertyValue('--terminal-height') || '0', 10)
  const panelWidth = Number.parseInt(style.getPropertyValue('--panel-width') || '0', 10)

  if (!flowContainer) {
    return {
      width: window.innerWidth - sidebarWidth - panelWidth,
      height: window.innerHeight - terminalHeight,
      offsetLeft: sidebarWidth,
      offsetRight: panelWidth,
      offsetBottom: terminalHeight,
    }
  }

  const rect = flowContainer.getBoundingClientRect()

  // Calculate actual visible area in screen coordinates
  // This works regardless of whether the container extends under overlays
  const visibleLeft = Math.max(rect.left, sidebarWidth)
  const visibleRight = Math.min(rect.right, window.innerWidth - panelWidth)
  const visibleBottom = Math.min(rect.bottom, window.innerHeight - terminalHeight)

  // Calculate visible dimensions and offsets relative to the container
  const visibleWidth = Math.max(0, visibleRight - visibleLeft)
  const visibleHeight = Math.max(0, visibleBottom - rect.top)

  return {
    width: visibleWidth,
    height: visibleHeight,
    offsetLeft: visibleLeft - rect.left,
    offsetRight: rect.right - visibleRight,
    offsetBottom: rect.bottom - visibleBottom,
  }
}

/**
 * Gets the center of the visible canvas in screen coordinates.
 */
function getVisibleCanvasCenter(options?: CanvasViewportOptions): { x: number; y: number } {
  const bounds = getVisibleCanvasBounds(options)

  const flowContainer = document.querySelector('.react-flow')
  const rect = flowContainer?.getBoundingClientRect()
  const containerLeft = rect?.left ?? 0
  const containerTop = rect?.top ?? 0

  return {
    x: containerLeft + bounds.offsetLeft + bounds.width / 2,
    y: containerTop + bounds.height / 2,
  }
}

interface FitViewToBoundsOptions {
  padding?: number
  maxZoom?: number
  minZoom?: number
  duration?: number
  nodes?: Node[]
}

/**
 * Hook providing canvas viewport utilities that account for sidebar, panel, and terminal overlays.
 */
export function useCanvasViewport(
  reactFlowInstance: ReactFlowInstance | null,
  viewportOptions?: CanvasViewportOptions
) {
  const embedded = viewportOptions?.embedded
  const stableOptions = useMemo<CanvasViewportOptions | undefined>(
    () => (embedded ? { embedded } : undefined),
    [embedded]
  )

  /**
   * Gets the center of the visible canvas in flow coordinates.
   */
  const getViewportCenter = useCallback(() => {
    if (!reactFlowInstance) {
      return { x: 0, y: 0 }
    }

    const center = getVisibleCanvasCenter(stableOptions)
    return reactFlowInstance.screenToFlowPosition(center)
  }, [reactFlowInstance, stableOptions])

  /**
   * Fits the view to show all nodes within the visible canvas bounds,
   * accounting for sidebar, panel, and terminal overlays.
   * @param padding - Fraction of viewport to leave as margin (0.1 = 10% on each side)
   */
  const fitViewToBounds = useCallback(
    (options: FitViewToBoundsOptions = {}) => {
      if (!reactFlowInstance) return

      const {
        padding = 0.1,
        maxZoom = 1,
        minZoom = 0.1,
        duration = 300,
        nodes: targetNodes,
      } = options

      const nodes = targetNodes ?? reactFlowInstance.getNodes()
      if (nodes.length === 0) {
        return
      }

      const bounds = getVisibleCanvasBounds(stableOptions)

      // Calculate node bounds
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY

      nodes.forEach((node) => {
        const nodeWidth = node.width ?? BLOCK_DIMENSIONS.FIXED_WIDTH
        const nodeHeight = node.height ?? BLOCK_DIMENSIONS.MIN_HEIGHT

        minX = Math.min(minX, node.position.x)
        minY = Math.min(minY, node.position.y)
        maxX = Math.max(maxX, node.position.x + nodeWidth)
        maxY = Math.max(maxY, node.position.y + nodeHeight)
      })

      const contentWidth = maxX - minX
      const contentHeight = maxY - minY

      // Apply padding as fraction of viewport (matches ReactFlow's fitView behavior)
      const availableWidth = bounds.width * (1 - padding * 2)
      const availableHeight = bounds.height * (1 - padding * 2)

      // Calculate zoom to fit content in available area
      const zoomX = availableWidth / contentWidth
      const zoomY = availableHeight / contentHeight
      const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(zoomX, zoomY)))

      // Calculate center of content in flow coordinates
      const contentCenterX = minX + contentWidth / 2
      const contentCenterY = minY + contentHeight / 2

      // Calculate viewport position to center content in visible area
      // Account for sidebar offset on the left
      const visibleCenterX = bounds.offsetLeft + bounds.width / 2
      const visibleCenterY = bounds.height / 2

      const x = visibleCenterX - contentCenterX * zoom
      const y = visibleCenterY - contentCenterY * zoom

      reactFlowInstance.setViewport({ x, y, zoom }, { duration })
    },
    [reactFlowInstance, stableOptions]
  )

  return {
    getViewportCenter,
    fitViewToBounds,
  }
}
