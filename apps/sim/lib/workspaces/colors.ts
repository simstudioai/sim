import { hexToRgb } from '@/lib/colors'

/**
 * User color palette matching terminal.tsx RUN_ID_COLORS
 * These colors are used consistently across cursors, avatars, and terminal run IDs
 */
export const USER_COLORS = [
  '#4ADE80', // Green
  '#F472B6', // Pink
  '#60C5FF', // Blue
  '#FF8533', // Orange
  '#C084FC', // Purple
  '#FCD34D', // Yellow
] as const

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}){1,2}$/

function hashIdentifier(identifier: string | number): number {
  if (typeof identifier === 'number' && Number.isFinite(identifier)) {
    return Math.abs(Math.trunc(identifier))
  }

  if (typeof identifier === 'string') {
    return Math.abs(Array.from(identifier).reduce((acc, char) => acc + char.charCodeAt(0), 0))
  }

  return 0
}

export function withAlpha(hexColor: string, alpha: number): string {
  if (!HEX_COLOR_REGEX.test(hexColor)) {
    return hexColor
  }

  const { r, g, b } = hexToRgb(hexColor)
  return `rgba(${r}, ${g}, ${b}, ${Math.min(Math.max(alpha, 0), 1)})`
}

/**
 * Gets a consistent color for a user based on their ID.
 * The same user will always get the same color across cursors, avatars, and terminal.
 *
 * @param userId - The unique user identifier
 * @returns A hex color string
 */
export function getUserColor(userId: string): string {
  const hash = hashIdentifier(userId)
  return USER_COLORS[hash % USER_COLORS.length]
}
