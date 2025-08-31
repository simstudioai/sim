import OpenAI, { AzureOpenAI } from 'openai'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SimAgentUtils')

const azureApiKey = env.AZURE_OPENAI_API_KEY
const azureEndpoint = env.AZURE_OPENAI_ENDPOINT
const azureApiVersion = env.AZURE_OPENAI_API_VERSION
const chatTitleModelName = env.WAND_OPENAI_MODEL_NAME || 'gpt-4o'
const openaiApiKey = env.OPENAI_API_KEY

const useChatTitleAzure = azureApiKey && azureEndpoint && azureApiVersion

const client = useChatTitleAzure
  ? new AzureOpenAI({
      apiKey: azureApiKey,
      apiVersion: azureApiVersion,
      endpoint: azureEndpoint,
    })
  : openaiApiKey
    ? new OpenAI({
        apiKey: openaiApiKey,
      })
    : null

/**
 * Generates a short title for a chat based on the first message
 * @param message First user message in the chat
 * @returns A short title or null if API key is not available
 */
export async function generateChatTitle(message: string): Promise<string | null> {
  if (!client) {
    return null
  }

  try {
    const response = await client.chat.completions.create({
      model: useChatTitleAzure ? chatTitleModelName : 'gpt-4o',
      messages: [
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
      max_tokens: 20,
      temperature: 0.2,
    })

    const title = response.choices[0]?.message?.content?.trim() || null
    return title
  } catch (error) {
    logger.error('Error generating chat title:', error)
    return null
  }
}
