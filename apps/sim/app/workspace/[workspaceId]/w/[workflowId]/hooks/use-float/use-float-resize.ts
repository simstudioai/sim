import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_CHAT_HEIGHT,
  MAX_CHAT_WIDTH,
  MIN_CHAT_HEIGHT,
  MIN_CHAT_WIDTH,
} from '@/stores/chat/utils'

interface UseFloatResizeProps {
  position: { x: number; y: number }
  width: number
  height: number
  onPositionChange: (position: { x: number; y: number }) => void
  onDimensionsChange: (dimensions: { width: number; height: number }) => void
  /**
   * Optional dimension constraints.
   * If omitted, chat defaults are used for backward compatibility.
   */
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

/**
 * Resize direction types - supports all 8 directions (4 corners + 4 edges)
 */
type ResizeDirection =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  | null

/**
 * Edge detection threshold in pixels (matches sidebar/panel resize handle width)
 */
const EDGE_THRESHOLD = 8

/**
 * Hook for handling multi-directional resize functionality of floating panels.
 * Supports resizing from all 8 directions: 4 corners and 4 edges.
 */
export function useFloatResize({
  position,
  width,
  height,
  onPositionChange,
  onDimensionsChange,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
}: UseFloatResizeProps) {
  const [cursor, setCursor] = useState<string>('')
  const isResizingRef = useRef(false)
  const activeDirectionRef = useRef<ResizeDirection>(null)
  const resizeStartRef = useRef({ x: 0, y: 0 })
  const initialStateRef = useRef({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })

  /**
   * Detect which edge or corner the mouse is near
   * @param e - Mouse event
   * @param chatElement - Chat container element
   * @returns The direction the mouse is near, or null
   */
  const detectResizeDirection = useCallback(
    (e: React.MouseEvent, chatElement: HTMLElement): ResizeDirection => {
      const rect = chatElement.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const isNearTop = y <= EDGE_THRESHOLD
      const isNearBottom = y >= rect.height - EDGE_THRESHOLD
      const isNearLeft = x <= EDGE_THRESHOLD
      const isNearRight = x >= rect.width - EDGE_THRESHOLD

      if (isNearTop && isNearLeft) return 'top-left'
      if (isNearTop && isNearRight) return 'top-right'
      if (isNearBottom && isNearLeft) return 'bottom-left'
      if (isNearBottom && isNearRight) return 'bottom-right'

      if (isNearTop) return 'top'
      if (isNearBottom) return 'bottom'
      if (isNearLeft) return 'left'
      if (isNearRight) return 'right'

      return null
    },
    []
  )

  /**
   * Get cursor style for a given resize direction
   */
  const getCursorForDirection = useCallback((direction: ResizeDirection): string => {
    switch (direction) {
      case 'top-left':
      case 'bottom-right':
        return 'nwse-resize'
      case 'top-right':
      case 'bottom-left':
        return 'nesw-resize'
      case 'top':
      case 'bottom':
        return 'ns-resize'
      case 'left':
      case 'right':
        return 'ew-resize'
      default:
        return ''
    }
  }, [])

  /**
   * Handle mouse move over chat - update cursor based on proximity to edges/corners
   */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isResizingRef.current) return

      const chatElement = e.currentTarget as HTMLElement
      const direction = detectResizeDirection(e, chatElement)
      const newCursor = getCursorForDirection(direction)

      if (newCursor !== cursor) {
        setCursor(newCursor)
      }
    },
    [cursor, detectResizeDirection, getCursorForDirection]
  )

  /**
   * Handle mouse leave - reset cursor
   */
  const handleMouseLeave = useCallback(() => {
    if (!isResizingRef.current) {
      setCursor('')
    }
  }, [])

  /**
   * Handle mouse down on edge/corner - start resizing
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return

      const chatElement = e.currentTarget as HTMLElement
      const direction = detectResizeDirection(e, chatElement)

      if (!direction) return

      e.preventDefault()
      e.stopPropagation()

      isResizingRef.current = true
      activeDirectionRef.current = direction
      resizeStartRef.current = { x: e.clientX, y: e.clientY }
      initialStateRef.current = {
        x: position.x,
        y: position.y,
        width,
        height,
      }

      document.body.style.cursor = getCursorForDirection(direction)
      document.body.style.userSelect = 'none'
    },
    [position, width, height, detectResizeDirection, getCursorForDirection]
  )

  /**
   * Handle global mouse move - update dimensions while resizing
   */
  const handleGlobalMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizingRef.current || !activeDirectionRef.current) return

      let deltaX = e.clientX - resizeStartRef.current.x
      let deltaY = e.clientY - resizeStartRef.current.y
      const initial = initialStateRef.current
      const direction = activeDirectionRef.current

      const sidebarWidth = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
      )
      const panelWidth = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
      )
      const terminalHeight = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
      )

      if (direction === 'top' || direction === 'top-left' || direction === 'top-right') {
        const maxUpwardDelta = initial.y
        if (deltaY < -maxUpwardDelta) {
          deltaY = -maxUpwardDelta
        }
      }

      if (direction === 'bottom' || direction === 'bottom-left' || direction === 'bottom-right') {
        const maxBottom = window.innerHeight - terminalHeight
        const initialBottom = initial.y + initial.height
        const maxDeltaY = maxBottom - initialBottom

        if (deltaY > maxDeltaY) {
          deltaY = maxDeltaY
        }
      }

      if (direction === 'left' || direction === 'top-left' || direction === 'bottom-left') {
        const minLeft = sidebarWidth
        const minDeltaX = minLeft - initial.x

        if (deltaX < minDeltaX) {
          deltaX = minDeltaX
        }
      }

      if (direction === 'right' || direction === 'top-right' || direction === 'bottom-right') {
        const maxRight = window.innerWidth - panelWidth
        const initialRight = initial.x + initial.width
        const maxDeltaX = maxRight - initialRight

        if (deltaX > maxDeltaX) {
          deltaX = maxDeltaX
        }
      }

      let newX = initial.x
      let newY = initial.y
      let newWidth = initial.width
      let newHeight = initial.height

      switch (direction) {
        case 'top-left':
          newWidth = initial.width - deltaX
          newHeight = initial.height - deltaY
          newX = initial.x + deltaX
          newY = initial.y + deltaY
          break
        case 'top-right':
          newWidth = initial.width + deltaX
          newHeight = initial.height - deltaY
          newY = initial.y + deltaY
          break
        case 'bottom-left':
          newWidth = initial.width - deltaX
          newHeight = initial.height + deltaY
          newX = initial.x + deltaX
          break
        case 'bottom-right':
          newWidth = initial.width + deltaX
          newHeight = initial.height + deltaY
          break

        case 'top':
          newHeight = initial.height - deltaY
          newY = initial.y + deltaY
          break
        case 'bottom':
          newHeight = initial.height + deltaY
          break
        case 'left':
          newWidth = initial.width - deltaX
          newX = initial.x + deltaX
          break
        case 'right':
          newWidth = initial.width + deltaX
          break
      }

      const effectiveMinWidth = typeof minWidth === 'number' ? minWidth : MIN_CHAT_WIDTH
      const effectiveMaxWidth = typeof maxWidth === 'number' ? maxWidth : MAX_CHAT_WIDTH
      const effectiveMinHeight = typeof minHeight === 'number' ? minHeight : MIN_CHAT_HEIGHT
      const effectiveMaxHeight = typeof maxHeight === 'number' ? maxHeight : MAX_CHAT_HEIGHT

      const constrainedWidth = Math.max(effectiveMinWidth, Math.min(effectiveMaxWidth, newWidth))
      const constrainedHeight = Math.max(
        effectiveMinHeight,
        Math.min(effectiveMaxHeight, newHeight)
      )

      if (direction === 'top-left' || direction === 'bottom-left' || direction === 'left') {
        if (constrainedWidth !== newWidth) {
          newX = initial.x + initial.width - constrainedWidth
        }
      }
      if (direction === 'top-left' || direction === 'top-right' || direction === 'top') {
        if (constrainedHeight !== newHeight) {
          newY = initial.y + initial.height - constrainedHeight
        }
      }

      const minX = sidebarWidth
      const maxX = window.innerWidth - panelWidth - constrainedWidth
      const minY = 0
      const maxY = window.innerHeight - terminalHeight - constrainedHeight

      const finalX = Math.max(minX, Math.min(maxX, newX))
      const finalY = Math.max(minY, Math.min(maxY, newY))

      onDimensionsChange({
        width: constrainedWidth,
        height: constrainedHeight,
      })
      onPositionChange({
        x: finalX,
        y: finalY,
      })
    },
    [onDimensionsChange, onPositionChange]
  )

  /**
   * Handle global mouse up - stop resizing
   */
  const handleGlobalMouseUp = useCallback(() => {
    if (!isResizingRef.current) return

    isResizingRef.current = false
    activeDirectionRef.current = null

    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setCursor('')
  }, [])

  /**
   * Set up global mouse event listeners
   */
  useEffect(() => {
    window.addEventListener('mousemove', handleGlobalMouseMove)
    window.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove)
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [handleGlobalMouseMove, handleGlobalMouseUp])

  return {
    cursor,
    handleMouseMove,
    handleMouseLeave,
    handleMouseDown,
  }
}
