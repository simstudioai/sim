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

/**
 * Hash a user ID to generate a consistent numeric index
 *
 * @param userId - The user ID to hash
 * @returns A positive integer
 */
function hashUserId(userId: string): number {
  return Math.abs(Array.from(userId).reduce((acc, char) => acc + char.charCodeAt(0), 0))
}

/**
 * Gets a consistent color for a user based on their ID.
 * The same user will always get the same color across cursors, avatars, and terminal.
 *
 * @param userId - The unique user identifier
 * @returns A hex color string
 */
export function getUserColor(userId: string): string {
  const hash = hashUserId(userId)
  return USER_COLORS[hash % USER_COLORS.length]
}

/**
 * Creates a stable mapping of user IDs to color indices for a list of users.
 * Useful when you need to maintain consistent color assignments across renders.
 *
 * @param userIds - Array of user IDs to map
 * @returns Map of user ID to color index
 */
export function createUserColorMap(userIds: string[]): Map<string, number> {
  const colorMap = new Map<string, number>()
  let colorIndex = 0

  for (const userId of userIds) {
    if (!colorMap.has(userId)) {
      colorMap.set(userId, colorIndex++)
    }
  }

  return colorMap
}
