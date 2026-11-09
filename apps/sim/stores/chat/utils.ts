import { getPanelWidth, getTerminalHeight } from '@/lib/workflows/layout'
import type { ChatPosition } from '@/stores/chat/types'

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
  const panelWidth = getPanelWidth()
  const terminalHeight = getTerminalHeight()

  const minX = sidebarWidth
  const maxX = window.innerWidth - CONTENT_WINDOW_GAP - panelWidth - width
  const minY = CONTENT_WINDOW_GAP
  const maxY = window.innerHeight - CONTENT_WINDOW_GAP - terminalHeight - height

  return {
    x: Math.max(minX, Math.min(maxX, position.x)),
    y: Math.max(minY, Math.min(maxY, position.y)),
  }
}
