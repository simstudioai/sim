export function getLiveAssistantMessageId(streamId: string): string {
  return `live-assistant:${streamId}`
}

/**
 * True for the synthetic id of a streaming/just-streamed assistant message.
 * These ids exist only in the effective transcript built for the client —
 * never in the persisted one — so message-scoped server actions (e.g. fork)
 * must not be offered until the transcript refetch swaps in the persisted
 * message id.
 */
export function isLiveAssistantMessageId(messageId: string): boolean {
  return messageId.startsWith('live-assistant:')
}

/**
 * True for a persisted assistant turn. Its turn has ended, so a tool row it left
 * pending, executing or awaiting approval did not finish and never runs again.
 */
export function isStoredAssistantMessage(message: { role: string; id: string }): boolean {
  return message.role === 'assistant' && !isLiveAssistantMessageId(message.id)
}
