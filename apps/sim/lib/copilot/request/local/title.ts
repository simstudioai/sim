import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { executeProviderRequest } from '@/providers'

const logger = createLogger('LocalMothershipTitle')
const MAX_TITLE_LENGTH = 80

function cleanTitle(value: string): string | null {
  const title = value
    .trim()
    .split('\n')[0]
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .slice(0, MAX_TITLE_LENGTH)
  return title || null
}

/** Generate a workspace chat title without calling the hosted Mothership. */
export async function requestLocalChatTitle(message: string): Promise<string | null> {
  const model = env.MOTHERSHIP_MODEL
  if (!message || !model) return null
  if (!model.startsWith('litellm/')) return null

  try {
    const response = await executeProviderRequest('litellm', {
      model,
      systemPrompt:
        'Write a short, specific title for this chat. Return only the title, without quotes or punctuation at the end.',
      messages: [{ role: 'user', content: message }],
      maxTokens: 24,
      stream: false,
    })
    if (!('content' in response) || typeof response.content !== 'string') return null
    return cleanTitle(response.content)
  } catch (error) {
    logger.warn('Local chat title generation failed', { error: toError(error).message })
    return null
  }
}
