import { createLogger } from '@sim/logger'
import { COPILOT_UPDATE_MESSAGES_API_PATH } from '@/lib/copilot/constants'
import type { CopilotMessage } from '@/stores/panel/copilot/types'
import { serializeMessagesForDB } from './serialization'

const logger = createLogger('CopilotMessagePersistence')

export async function persistMessages(params: {
  chatId: string
  messages: CopilotMessage[]
  sensitiveCredentialIds?: Set<string>
  planArtifact?: string | null
  mode?: string
  model?: string
  conversationId?: string
}): Promise<boolean> {
  try {
    const dbMessages = serializeMessagesForDB(
      params.messages,
      params.sensitiveCredentialIds ?? new Set<string>()
    )
    const response = await fetch(COPILOT_UPDATE_MESSAGES_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: params.chatId,
        messages: dbMessages,
        ...(params.planArtifact !== undefined ? { planArtifact: params.planArtifact } : {}),
        ...(params.mode || params.model
          ? { config: { mode: params.mode, model: params.model } }
          : {}),
        ...(params.conversationId ? { conversationId: params.conversationId } : {}),
      }),
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
