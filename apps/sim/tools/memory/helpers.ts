/**
 * Parse memory key into conversationId and blockId
 * Key format: conversationId:blockId
 * @param key The memory key to parse
 * @returns Object with conversationId and blockId, or null if invalid
 */
export function parseMemoryKey(key: string): { conversationId: string; blockId: string } | null {
  const parts = key.split(':')
  if (parts.length !== 2) {
    return null
  }

  return {
    conversationId: parts[0],
    blockId: parts[1],
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
