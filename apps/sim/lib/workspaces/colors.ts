import { hexToRgb } from '@/lib/colors'

/**
 * Shared identity palette for cursors, avatars, and collaborator selections.
 * Colour values live in globals.css; keep the order stable for user ID hashing.
 */
export const USER_COLORS = [
  'var(--indicator-active)', // Green
  'var(--color-pink-400)',
  'var(--brand-secondary)', // Blue
  'var(--color-orange-400)',
  'var(--color-purple-400)',
  'var(--color-amber-300)',
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

export function withAlpha(color: string, alpha: number): string {
  const opacity = Math.min(Math.max(alpha, 0), 1)
  if (color.startsWith('var(')) {
    return `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`
  }
  if (!HEX_COLOR_REGEX.test(color)) {
    return color
  }

  const { r, g, b } = hexToRgb(color)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

/**
 * Gets a consistent color for a user based on their ID.
 * The same user will always get the same color across cursors, avatars, and selections.
 *
 * @param userId - The unique user identifier
 * @returns A CSS colour variable reference
 */
export function getUserColor(userId: string): string {
  const hash = hashIdentifier(userId)
  return USER_COLORS[hash % USER_COLORS.length]
}
