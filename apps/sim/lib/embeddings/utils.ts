import { env } from '@/lib/env'
import { isRetryableError, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { batchByTokenLimit, getTotalTokenCount } from '@/lib/tokenization'

const logger = createLogger('EmbeddingUtils')

const MAX_TOKENS_PER_REQUEST = 8000

export class EmbeddingAPIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'EmbeddingAPIError'
    this.status = status
  }
}

interface EmbeddingConfig {
  useAzure: boolean
  apiUrl: string
  headers: Record<string, string>
  modelName: string
}

function getEmbeddingConfig(embeddingModel = 'text-embedding-3-small'): EmbeddingConfig {
  const azureApiKey = env.AZURE_OPENAI_API_KEY
  const azureEndpoint = env.AZURE_OPENAI_ENDPOINT
  const azureApiVersion = env.AZURE_OPENAI_API_VERSION
  const kbModelName = env.KB_OPENAI_MODEL_NAME || embeddingModel
  const openaiApiKey = env.OPENAI_API_KEY

  const useAzure = !!(azureApiKey && azureEndpoint)

  if (!useAzure && !openaiApiKey) {
    throw new Error(
      'Either OPENAI_API_KEY or Azure OpenAI configuration (AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT) must be configured'
    )
  }

  const apiUrl = useAzure
    ? `${azureEndpoint}/openai/deployments/${kbModelName}/embeddings?api-version=${azureApiVersion}`
    : 'https://api.openai.com/v1/embeddings'

  const headers: Record<string, string> = useAzure
    ? {
        'api-key': azureApiKey!,
        'Content-Type': 'application/json',
      }
    : {
        Authorization: `Bearer ${openaiApiKey!}`,
        'Content-Type': 'application/json',
      }

  return {
    useAzure,
    apiUrl,
    headers,
    modelName: useAzure ? kbModelName : embeddingModel,
  }
}

async function callEmbeddingAPI(inputs: string[], config: EmbeddingConfig): Promise<number[][]> {
  return retryWithExponentialBackoff(
    async () => {
      const requestBody = config.useAzure
        ? {
            input: inputs,
            encoding_format: 'float',
          }
        : {
            input: inputs,
            model: config.modelName,
            encoding_format: 'float',
          }

      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new EmbeddingAPIError(
          `Embedding API failed: ${response.status} ${response.statusText} - ${errorText}`,
          response.status
        )
      }

      const data = await response.json()
      return data.data.map((item: any) => item.embedding)
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryCondition: (error: any) => {
        if (error instanceof EmbeddingAPIError) {
          return error.status === 429 || error.status >= 500
        }
        return isRetryableError(error)
      },
    }
  )
}

/**
 * Generate embeddings for multiple texts with token-aware batching
 * Uses tiktoken for token counting
 */
export async function generateEmbeddings(
  texts: string[],
  embeddingModel = 'text-embedding-3-small'
): Promise<number[][]> {
  const config = getEmbeddingConfig(embeddingModel)

  logger.info(
    `Using ${config.useAzure ? 'Azure OpenAI' : 'OpenAI'} for embeddings generation (${texts.length} texts)`
  )

  const batches = batchByTokenLimit(texts, MAX_TOKENS_PER_REQUEST, embeddingModel)

  logger.info(
    `Split ${texts.length} texts into ${batches.length} batches (max ${MAX_TOKENS_PER_REQUEST} tokens per batch)`
  )

  const allEmbeddings: number[][] = []

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const batchTokenCount = getTotalTokenCount(batch, embeddingModel)

    logger.info(
      `Processing batch ${i + 1}/${batches.length}: ${batch.length} texts, ${batchTokenCount} tokens`
    )

    try {
      const batchEmbeddings = await callEmbeddingAPI(batch, config)
      allEmbeddings.push(...batchEmbeddings)

      logger.info(
        `Generated ${batchEmbeddings.length} embeddings for batch ${i + 1}/${batches.length}`
      )
    } catch (error) {
      logger.error(`Failed to generate embeddings for batch ${i + 1}:`, error)
      throw error
    }

    if (i + 1 < batches.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  logger.info(`Successfully generated ${allEmbeddings.length} embeddings total`)

  return allEmbeddings
}

/**
 * Generate embedding for a single search query
 */
export async function generateSearchEmbedding(
  query: string,
  embeddingModel = 'text-embedding-3-small'
): Promise<number[]> {
  const config = getEmbeddingConfig(embeddingModel)

  logger.info(
    `Using ${config.useAzure ? 'Azure OpenAI' : 'OpenAI'} for search embedding generation`
  )

  const embeddings = await callEmbeddingAPI([query], config)
  return embeddings[0]
}
