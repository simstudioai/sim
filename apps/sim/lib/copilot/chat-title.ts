import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'

const logger = createLogger('SimAgentUtils')

interface GenerateChatTitleParams {
  message: string
  model: string
  provider?: string
}

/**
 * Generates a short title for a chat based on the first message
 * using the Copilot backend's server-side provider configuration.
 */
export async function generateChatTitle({
  message,
  model,
  provider,
}: GenerateChatTitleParams): Promise<string | null> {
  if (!message || !model) {
    return null
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/generate-chat-title`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        model,
        ...(provider ? { provider } : {}),
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      logger.warn('Failed to generate chat title via copilot backend', {
        status: response.status,
        error: payload,
      })
      return null
    }

    const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
    return title || null
  } catch (error) {
    logger.error('Error generating chat title:', error)
    return null
  }
}
