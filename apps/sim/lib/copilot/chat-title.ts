import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { extractResponseText } from '@/providers/openai/utils'

const logger = createLogger('SimAgentUtils')

const azureApiKey = env.AZURE_OPENAI_API_KEY
const azureEndpoint = env.AZURE_OPENAI_ENDPOINT
const azureApiVersion = env.AZURE_OPENAI_API_VERSION
const chatTitleModelName = env.WAND_OPENAI_MODEL_NAME || 'gpt-4o'
const openaiApiKey = env.OPENAI_API_KEY

const useChatTitleAzure = azureApiKey && azureEndpoint && azureApiVersion

/**
 * Generates a short title for a chat based on the first message
 * @param message First user message in the chat
 * @returns A short title or null if API key is not available
 */
export async function generateChatTitle(message: string): Promise<string | null> {
  if (!useChatTitleAzure && !openaiApiKey) {
    return null
  }

  try {
    const apiUrl = useChatTitleAzure
      ? `${azureEndpoint?.replace(/\/$/, '')}/openai/v1/responses?api-version=${azureApiVersion}`
      : 'https://api.openai.com/v1/responses'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'responses=v1',
    }

    if (useChatTitleAzure) {
      headers['api-key'] = azureApiKey!
    } else {
      headers.Authorization = `Bearer ${openaiApiKey}`
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: useChatTitleAzure ? chatTitleModelName : 'gpt-4o',
        input: [
          {
            role: 'system',
            content:
              'Generate a very short title (3-5 words max) for a chat that starts with this message. The title should be concise and descriptive. Do not wrap the title in quotes.',
          },
          {
            role: 'user',
            content: message,
          },
        ],
        max_output_tokens: 20,
        temperature: 0.2,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Error generating chat title:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return null
    }

    const data = await response.json()
    const title = extractResponseText(data.output)?.trim() || null
    return title
  } catch (error) {
    logger.error('Error generating chat title:', error)
    return null
  }
}
