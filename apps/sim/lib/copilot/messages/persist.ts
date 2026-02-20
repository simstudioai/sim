import { createLogger } from '@sim/logger'
import { COPILOT_UPDATE_MESSAGES_API_PATH } from '@/lib/copilot/constants'
import type { CopilotMessage } from '@/stores/panel/copilot/types'
import { serializeMessagesForDB } from './serialization'

const logger = createLogger('CopilotMessagePersistence')

interface PersistParams {
  chatId: string
  messages: CopilotMessage[]
  sensitiveCredentialIds?: Set<string>
  planArtifact?: string | null
  mode?: string
  model?: string
  conversationId?: string
}

/** Builds the JSON body used by both fetch and sendBeacon persistence paths. */
function buildPersistBody(params: PersistParams): string {
  const dbMessages = serializeMessagesForDB(
    params.messages,
    params.sensitiveCredentialIds ?? new Set<string>()
  )
  return JSON.stringify({
    chatId: params.chatId,
    messages: dbMessages,
    ...(params.planArtifact !== undefined ? { planArtifact: params.planArtifact } : {}),
    ...(params.mode || params.model ? { config: { mode: params.mode, model: params.model } } : {}),
    ...(params.conversationId ? { conversationId: params.conversationId } : {}),
  })
}

export async function persistMessages(params: PersistParams): Promise<boolean> {
  try {
    const response = await fetch(COPILOT_UPDATE_MESSAGES_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildPersistBody(params),
    })
    return response.ok
  } catch (error) {
    logger.warn('Failed to persist messages', {
      chatId: params.chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Persists messages using navigator.sendBeacon, which is reliable during page unload.
 * Unlike fetch, sendBeacon is guaranteed to be queued even when the page is being torn down.
 */
export function persistMessagesBeacon(params: PersistParams): boolean {
  try {
    const body = buildPersistBody(params)
    const blob = new Blob([body], { type: 'application/json' })
    const sent = navigator.sendBeacon(COPILOT_UPDATE_MESSAGES_API_PATH, blob)
    if (!sent) {
      logger.warn('sendBeacon returned false — browser may have rejected the request', {
        chatId: params.chatId,
      })
    }
    return sent
  } catch (error) {
    logger.warn('Failed to persist messages via sendBeacon', {
      chatId: params.chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
