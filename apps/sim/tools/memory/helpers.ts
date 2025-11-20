/**
 * Parse memory key into conversationId and blockId
 * Supports two formats:
 * - New format: conversationId:blockId (splits on LAST colon to handle IDs with colons)
 * - Legacy format: id (without colon, treated as conversationId with blockId='default')
 * @param key The memory key to parse
 * @returns Object with conversationId and blockId, or null if invalid
 */
export function parseMemoryKey(key: string): { conversationId: string; blockId: string } | null {
  if (!key) {
    return null
  }

  const lastColonIndex = key.lastIndexOf(':')

  // Legacy format: no colon found
  if (lastColonIndex === -1) {
    return {
      conversationId: key,
      blockId: 'default',
    }
  }

  // Invalid: colon at start or end
  if (lastColonIndex === 0 || lastColonIndex === key.length - 1) {
    return null
  }

  // New format: split on last colon to handle IDs with colons
  // This allows conversationIds like "user:123" to work correctly
  return {
    conversationId: key.substring(0, lastColonIndex),
    blockId: key.substring(lastColonIndex + 1),
  }
}

/**
 * Build memory key from conversationId and blockId
 * @param conversationId The conversation ID
 * @param blockId The block ID
 * @returns The memory key in format conversationId:blockId
 */
export function buildMemoryKey(conversationId: string, blockId: string): string {
  return `${conversationId}:${blockId}`
}
