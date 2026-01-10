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

/**
 * Calculate default position in top right of canvas, 32px from top and right of panel
 */
const calculateDefaultPosition = (): ChatPosition => {
  if (typeof window === 'undefined') {
    return { x: 100, y: 100 }
  }

  // Get current layout dimensions
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )

  // Position in top right of canvas, 32px from top and 32px from right of panel
  const x = window.innerWidth - panelWidth - 32 - DEFAULT_WIDTH
  const y = 32

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
 * @param position - Current position to constrain
 * @param width - Chat width
 * @param height - Chat height
 * @returns Constrained position
 */
export const constrainChatPosition = (
  position: ChatPosition,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): ChatPosition => {
  if (typeof window === 'undefined') {
    return position
  }

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

  // Calculate bounds
  const minX = sidebarWidth
  const maxX = window.innerWidth - panelWidth - width
  const minY = 0
  const maxY = window.innerHeight - terminalHeight - height

  // Constrain position
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
