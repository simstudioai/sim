export function getLiveAssistantMessageId(streamId: string): string {
  return `live-assistant:${streamId}`
}

/**
 * True for the synthetic id of a streaming/just-streamed assistant message.
 * These ids exist only in the client's effective transcript — never in the
 * persisted one — so message-scoped server actions (e.g. fork) must not be
 * offered until the transcript refetch swaps in the persisted message id.
 */
export function isLiveAssistantMessageId(messageId: string): boolean {
  return messageId.startsWith('live-assistant:')
}
