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

function hashIdentifier(identifier: string | number): number {
  if (typeof identifier === 'number' && Number.isFinite(identifier)) {
    return Math.abs(Math.trunc(identifier))
  }

  if (typeof identifier === 'string') {
    return Math.abs(Array.from(identifier).reduce((acc, char) => acc + char.charCodeAt(0), 0))
  }

  return 0
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
