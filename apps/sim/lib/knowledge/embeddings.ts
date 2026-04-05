import { createLogger } from '@sim/logger'
import { getBYOKKey } from '@/lib/api-key/byok'
import { env } from '@/lib/core/config/env'
import { isRetryableError, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import { batchByTokenLimit } from '@/lib/tokenization'

const logger = createLogger('EmbeddingUtils')

const MAX_TOKENS_PER_REQUEST = 8000
const MAX_CONCURRENT_BATCHES = env.KB_CONFIG_CONCURRENCY_LIMIT || 50
const EMBEDDING_DIMENSIONS = 1536

/**
 * Check if the model supports custom dimensions.
 * text-embedding-3-* models support the dimensions parameter.
 * Checks for 'embedding-3' to handle Azure deployments with custom naming conventions.
 */
function supportsCustomDimensions(modelName: string): boolean {
  const name = modelName.toLowerCase()
  return name.includes('embedding-3') && !name.includes('ada')
}

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
  isBYOK: boolean
}

interface EmbeddingResponseItem {
  embedding: number[]
  index: number
}

interface EmbeddingAPIResponse {
  data: EmbeddingResponseItem[]
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

async function getEmbeddingConfig(
  embeddingModel = 'text-embedding-3-small',
  workspaceId?: string | null
): Promise<EmbeddingConfig> {
  const azureApiKey = env.AZURE_OPENAI_API_KEY
  const azureEndpoint = env.AZURE_OPENAI_ENDPOINT
  const azureApiVersion = env.AZURE_OPENAI_API_VERSION
  const kbModelName = env.KB_OPENAI_MODEL_NAME || embeddingModel

  const useAzure = !!(azureApiKey && azureEndpoint)

  if (useAzure) {
    return {
      useAzure: true,
      apiUrl: `${azureEndpoint}/openai/deployments/${kbModelName}/embeddings?api-version=${azureApiVersion}`,
      headers: {
        'api-key': azureApiKey!,
        'Content-Type': 'application/json',
      },
      modelName: kbModelName,
      isBYOK: false,
    }
  }

  let openaiApiKey = env.OPENAI_API_KEY
  let isBYOK = false

  if (workspaceId) {
    const byokResult = await getBYOKKey(workspaceId, 'openai')
    if (byokResult) {
      logger.info('Using workspace BYOK key for OpenAI embeddings')
      openaiApiKey = byokResult.apiKey
      isBYOK = true
    }
  }

  if (!openaiApiKey) {
    throw new Error(
      'Either OPENAI_API_KEY or Azure OpenAI configuration (AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT) must be configured'
    )
  }

  return {
    useAzure: false,
    apiUrl: 'https://api.openai.com/v1/embeddings',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    modelName: embeddingModel,
    isBYOK,
  }
}

const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000

async function callEmbeddingAPI(
  inputs: string[],
  config: EmbeddingConfig
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  return retryWithExponentialBackoff(
    async () => {
      const useDimensions = supportsCustomDimensions(config.modelName)

      const requestBody = config.useAzure
        ? {
            input: inputs,
            encoding_format: 'float',
            ...(useDimensions && { dimensions: EMBEDDING_DIMENSIONS }),
          }
        : {
            input: inputs,
            model: config.modelName,
            encoding_format: 'float',
            ...(useDimensions && { dimensions: EMBEDDING_DIMENSIONS }),
          }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), EMBEDDING_REQUEST_TIMEOUT_MS)

      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      if (!response.ok) {
        const errorText = await response.text()
        throw new EmbeddingAPIError(
          `Embedding API failed: ${response.status} ${response.statusText} - ${errorText}`,
          response.status
        )
      }

      const data: EmbeddingAPIResponse = await response.json()
      return {
        embeddings: data.data.map((item) => item.embedding),
        totalTokens: data.usage.total_tokens,
      }
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryCondition: (error: unknown) => {
        if (error instanceof EmbeddingAPIError) {
          return error.status === 429 || error.status >= 500
        }
        return isRetryableError(error)
      },
    }
  )
}

/**
 * Process batches with controlled concurrency
 */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++
      results[index] = await processor(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

export interface GenerateEmbeddingsResult {
  embeddings: number[][]
  totalTokens: number
  isBYOK: boolean
  modelName: string
}

/**
 * Generate embeddings for multiple texts with token-aware batching and parallel processing.
 * Returns embeddings alongside actual token count, model name, and whether a workspace BYOK key
 * was used (vs. the platform's shared key) — enabling callers to make correct billing decisions.
 */
export async function generateEmbeddings(
  texts: string[],
  embeddingModel = 'text-embedding-3-small',
  workspaceId?: string | null
): Promise<GenerateEmbeddingsResult> {
  const config = await getEmbeddingConfig(embeddingModel, workspaceId)

  const batches = batchByTokenLimit(texts, MAX_TOKENS_PER_REQUEST, embeddingModel)

  const batchResults = await processWithConcurrency(
    batches,
    MAX_CONCURRENT_BATCHES,
    async (batch, i) => {
      try {
        return await callEmbeddingAPI(batch, config)
      } catch (error) {
        logger.error(`Failed to generate embeddings for batch ${i + 1}/${batches.length}:`, error)
        throw error
      }
    }
  )

  const allEmbeddings: number[][] = []
  let totalTokens = 0
  for (const batch of batchResults) {
    for (const emb of batch.embeddings) {
      allEmbeddings.push(emb)
    }
    totalTokens += batch.totalTokens
  }

  return {
    embeddings: allEmbeddings,
    totalTokens,
    isBYOK: config.isBYOK,
    modelName: config.modelName,
  }
}

/**
 * Generate embedding for a single search query
 */
export async function generateSearchEmbedding(
  query: string,
  embeddingModel = 'text-embedding-3-small',
  workspaceId?: string | null
): Promise<number[]> {
  const config = await getEmbeddingConfig(embeddingModel, workspaceId)

  logger.info(
    `Using ${config.useAzure ? 'Azure OpenAI' : 'OpenAI'} for search embedding generation`
  )

  const { embeddings } = await callEmbeddingAPI([query], config)
  return embeddings[0]
}
