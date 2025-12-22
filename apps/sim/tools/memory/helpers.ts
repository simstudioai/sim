/**
 * Parse memory key to extract conversationId
 * Memory is now thread-scoped, so the key is just the conversationId
 * @param key The memory key (conversationId)
 * @returns Object with conversationId, or null if invalid
 */
export function parseMemoryKey(key: string): { conversationId: string } | null {
  if (!key) {
    return null
  }

  return {
    conversationId: key,
  }
}

/**
 * Build memory key from conversationId
 * Memory is thread-scoped, so key is just the conversationId
 * @param conversationId The conversation ID
 * @returns The memory key (same as conversationId)
 */
export function buildMemoryKey(conversationId: string): string {
  return conversationId
}
