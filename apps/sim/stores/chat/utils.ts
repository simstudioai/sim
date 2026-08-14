import type { ChatPosition } from './types'

/**
 * Floating chat dimensions
 */
const DEFAULT_WIDTH = 305
const DEFAULT_HEIGHT = 286

/**
 * Minimum chat dimensions (same as baseline default)
 */
export const MIN_CHAT_WIDTH = DEFAULT_WIDTH
export const MIN_CHAT_HEIGHT = DEFAULT_HEIGHT

/**
 * Maximum chat dimensions
 */
export const MAX_CHAT_WIDTH = 500
export const MAX_CHAT_HEIGHT = 600

/** Inset gap between the viewport edge and the content window */
const CONTENT_WINDOW_GAP = 8

/**
 * Calculate default position in top right of canvas, offset from panel edge
 */
const calculateDefaultPosition = (): ChatPosition => {
  if (typeof window === 'undefined') {
    return { x: 100, y: 100 }
  }

  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )

  const x = window.innerWidth - CONTENT_WINDOW_GAP - panelWidth - 32 - DEFAULT_WIDTH
  const y = CONTENT_WINDOW_GAP + 32

  return { x, y }
}

/**
 * Get the default chat dimensions
 */
export const getDefaultChatDimensions = () => ({
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
})

/**
 * Calculate constrained position ensuring chat stays within bounds
 */
export const constrainChatPosition = (
  position: ChatPosition,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): ChatPosition => {
  if (typeof window === 'undefined') {
    return position
  }

  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const terminalHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )

  const minX = sidebarWidth
  const maxX = window.innerWidth - CONTENT_WINDOW_GAP - panelWidth - width
  const minY = CONTENT_WINDOW_GAP
  const maxY = window.innerHeight - CONTENT_WINDOW_GAP - terminalHeight - height

  return {
    x: Math.max(minX, Math.min(maxX, position.x)),
    y: Math.max(minY, Math.min(maxY, position.y)),
  }
}

/**
 * Get chat position (default if not set or if invalid)
 * @param storedPosition - Stored position from store
 * @param width - Chat width
 * @param height - Chat height
 * @returns Valid chat position
 */
export const getChatPosition = (
  storedPosition: ChatPosition | null,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): ChatPosition => {
  if (!storedPosition) {
    return calculateDefaultPosition()
  }

  // Validate stored position is still within bounds
  const constrained = constrainChatPosition(storedPosition, width, height)

  // If position significantly changed, it's likely invalid (window resized, etc)
  // Return default position
  const deltaX = Math.abs(constrained.x - storedPosition.x)
  const deltaY = Math.abs(constrained.y - storedPosition.y)

  if (deltaX > 100 || deltaY > 100) {
    return calculateDefaultPosition()
  }

  return constrained
}
