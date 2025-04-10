// In-memory store for message deduplication
const messageStore = new Map<string, { timestamp: number }>()

// Configuration
const MESSAGE_EXPIRY = 60 * 60 * 24 * 7 // 7 days in seconds
const MAX_MESSAGES = 10000 // Maximum number of messages to store

// Clean up expired messages periodically
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      const now = Math.floor(Date.now() / 1000)
      for (const [key, data] of messageStore.entries()) {
        if (now - data.timestamp > MESSAGE_EXPIRY) {
          messageStore.delete(key)
        }
      }
    },
    5 * 60 * 1000 // Clean up every 5 minutes
  )
}

/**
 * Check if a message ID has been processed before
 * @param messageId The message ID to check
 * @param expirySeconds Optional expiry time in seconds (defaults to 7 days)
 * @returns True if the message has been processed before, false otherwise
 */
export async function hasProcessedMessage(
  messageId: string,
  expirySeconds: number = MESSAGE_EXPIRY
): Promise<boolean> {
  const data = messageStore.get(messageId)
  if (!data) return false

  const now = Math.floor(Date.now() / 1000)
  if (now - data.timestamp > expirySeconds) {
    messageStore.delete(messageId)
    return false
  }

  return true
}

/**
 * Mark a message ID as processed
 * @param messageId The message ID to mark as processed
 * @param expirySeconds Optional expiry time in seconds (defaults to 7 days)
 */
export async function markMessageAsProcessed(
  messageId: string,
  expirySeconds: number = MESSAGE_EXPIRY
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  messageStore.set(messageId, { timestamp: now })

  // Clean up old messages if store gets too large
  if (messageStore.size > MAX_MESSAGES) {
    const entries = Array.from(messageStore.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toDelete = entries.slice(0, messageStore.size - MAX_MESSAGES)
    for (const [key] of toDelete) {
      messageStore.delete(key)
    }
  }
} 