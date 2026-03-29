import { createLogger } from '@sim/logger'
import { getBYOKKey } from '@/lib/api-key/byok'
import { env } from '@/lib/core/config/env'
import { isRetryableError, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import { batchByTokenLimit } from '@/lib/tokenization'

const logger = createLogger('EmbeddingUtils')

const MAX_TOKENS_PER_REQUEST = 8000
const MAX_CONCURRENT_BATCHES = env.KB_CONFIG_CONCURRENCY_LIMIT || 50
const EMBEDDING_DIMENSIONS = 1536

const OLLAMA_TIMEOUT_MS = 120_000

/** Resolve the Ollama base URL: explicit value > OLLAMA_URL env var > localhost default */
export function getOllamaBaseUrl(explicit?: string | null): string {
  return explicit || env.OLLAMA_URL || 'http://localhost:11434'
}

/** Default context length for Ollama embedding models when it cannot be queried */
const OLLAMA_DEFAULT_CONTEXT_LENGTH = 2048
/** Default embedding dimension for Ollama models when it cannot be queried */
const OLLAMA_DEFAULT_EMBEDDING_DIMENSION = 768
/** Cache TTL for Ollama model info (5 minutes) */
const OLLAMA_MODEL_CACHE_TTL_MS = 5 * 60 * 1000

export interface OllamaModelInfo {
  contextLength: number
  embeddingLength: number
}

/** In-memory cache for Ollama model info to avoid repeated /api/show calls */
const ollamaModelInfoCache = new Map<string, { info: OllamaModelInfo; ts: number }>()

/**
 * Query an Ollama model's info via the /api/show endpoint.
 * Returns context_length and embedding_length with in-memory caching.
 * Falls back to defaults on failure for runtime use (embedding generation).
 */
export async function getOllamaModelInfo(
  modelName: string,
  baseUrl?: string
): Promise<OllamaModelInfo> {
  baseUrl = getOllamaBaseUrl(baseUrl)
  const cacheKey = `${modelName}@${baseUrl}`
  const cached = ollamaModelInfoCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < OLLAMA_MODEL_CACHE_TTL_MS) {
    return cached.info
  }

  const defaults: OllamaModelInfo = {
    contextLength: OLLAMA_DEFAULT_CONTEXT_LENGTH,
    embeddingLength: OLLAMA_DEFAULT_EMBEDDING_DIMENSION,
  }

  try {
    const info = await fetchOllamaModelInfo(modelName, baseUrl)
    ollamaModelInfoCache.set(cacheKey, { info, ts: Date.now() })
    return info
  } catch (error) {
    logger.warn(
      `Error querying Ollama model info: ${error instanceof Error ? error.message : String(error)}`
    )
    ollamaModelInfoCache.set(cacheKey, { info: defaults, ts: Date.now() })
    return defaults
  }
}

/**
 * Validate that an Ollama model is reachable and return its info.
 * Unlike getOllamaModelInfo, this throws on failure — use during KB creation
 * to prevent creating a KB with incorrect dimensions.
 */
export async function validateOllamaModel(
  modelName: string,
  baseUrl?: string
): Promise<OllamaModelInfo> {
  baseUrl = getOllamaBaseUrl(baseUrl)
  const info = await fetchOllamaModelInfo(modelName, baseUrl)

  // Cache the validated result
  const cacheKey = `${modelName}@${baseUrl}`
  ollamaModelInfoCache.set(cacheKey, { info, ts: Date.now() })

  return info
}

/**
 * Internal: fetch model info from Ollama's /api/show endpoint.
 * Throws on network errors or non-OK responses.
 */
async function fetchOllamaModelInfo(modelName: string, baseUrl: string): Promise<OllamaModelInfo> {
  const defaults: OllamaModelInfo = {
    contextLength: OLLAMA_DEFAULT_CONTEXT_LENGTH,
    embeddingLength: OLLAMA_DEFAULT_EMBEDDING_DIMENSION,
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/show`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status} for model "${modelName}" at ${baseUrl}`)
  }

  const data = await response.json()
  const modelInfo = data?.model_info ?? {}

  const info: OllamaModelInfo = { ...defaults }

  for (const [key, value] of Object.entries(modelInfo)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.includes('context_length') && typeof value === 'number') {
      info.contextLength = value
    }
    if (lowerKey.includes('embedding_length') && typeof value === 'number') {
      info.embeddingLength = value
    }
  }

  logger.info(
    `Ollama model ${modelName}: context_length=${info.contextLength}, embedding_length=${info.embeddingLength}`
  )
  return info
}

/**
 * Query an Ollama model's context length (convenience wrapper).
 */
export async function getOllamaModelContextLength(
  modelName: string,
  baseUrl?: string
): Promise<number> {
  const info = await getOllamaModelInfo(modelName, baseUrl)
  return info.contextLength
}

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
    }
  }

  let openaiApiKey = env.OPENAI_API_KEY

  if (workspaceId) {
    const byokResult = await getBYOKKey(workspaceId, 'openai')
    if (byokResult) {
      logger.info('Using workspace BYOK key for OpenAI embeddings')
      openaiApiKey = byokResult.apiKey
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
  }
}

async function callEmbeddingAPI(inputs: string[], config: EmbeddingConfig): Promise<number[][]> {
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

      const data: EmbeddingAPIResponse = await response.json()
      return data.data.map((item) => item.embedding)
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

/**
 * Call Ollama's /api/embed endpoint for batch embedding generation.
 * Requires Ollama 0.1.26+ for the /api/embed endpoint with array input.
 */
async function callOllamaEmbeddingAPI(
  inputs: string[],
  modelName: string,
  baseUrl: string
): Promise<number[][]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/embed`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, input: inputs }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new EmbeddingAPIError(
      `Ollama embedding API failed: ${response.status} ${response.statusText} - ${errorText}`,
      response.status
    )
  }

  const data: { embeddings: number[][] } = await response.json()
  return data.embeddings
}

/**
 * Generate embeddings for multiple texts with token-aware batching and parallel processing
 */
export async function generateEmbeddings(
  texts: string[],
  embeddingModel = 'text-embedding-3-small',
  workspaceId?: string | null,
  ollamaBaseUrl?: string,
  contextLengthHint?: number
): Promise<number[][]> {
  if (embeddingModel.startsWith('ollama/')) {
    const modelName = embeddingModel.slice(7)
    const baseUrl = getOllamaBaseUrl(ollamaBaseUrl)
    logger.info(`Using Ollama (${baseUrl}) for embedding generation with model ${modelName}`)

    // Use pre-queried context length if provided, otherwise query it
    const contextLength =
      contextLengthHint ?? (await getOllamaModelContextLength(modelName, baseUrl))
    // Use contextLength as the max character count (assumes worst case ~1 char per token)
    const maxChars = contextLength

    // Truncate any chunks that exceed the context length, then batch by total character count
    const prepared: string[] = texts.map((text, i) => {
      if (text.length > maxChars) {
        const lastSentenceEnd = text.lastIndexOf('. ', maxChars)
        const truncatedLength = lastSentenceEnd > maxChars * 0.5 ? lastSentenceEnd + 1 : maxChars
        logger.warn(
          `Truncating chunk ${i} from ${text.length} to ${truncatedLength} chars ` +
            `(Ollama model ${modelName} context length: ${contextLength})`
        )
        return text.slice(0, truncatedLength)
      }
      return text
    })

    // Smart batching: group chunks so total characters per batch stays within maxChars
    const batches: string[][] = []
    let currentBatch: string[] = []
    let currentBatchChars = 0
    for (const text of prepared) {
      if (currentBatch.length > 0 && currentBatchChars + text.length > maxChars) {
        batches.push(currentBatch)
        currentBatch = []
        currentBatchChars = 0
      }
      currentBatch.push(text)
      currentBatchChars += text.length
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch)
    }

    logger.info(
      `[Ollama] Processing ${prepared.length} chunks in ${batches.length} batches (maxChars=${maxChars})`
    )

    // Process each batch with retry logic
    const allEmbeddings: number[][] = []
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]
      const batchEmbeddings = await retryWithExponentialBackoff(
        () => callOllamaEmbeddingAPI(batch, modelName, baseUrl),
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
      for (const emb of batchEmbeddings) {
        allEmbeddings.push(emb)
      }
    }
    return allEmbeddings
  }

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
  for (const batch of batchResults) {
    for (const emb of batch) {
      allEmbeddings.push(emb)
    }
  }

  return allEmbeddings
}

/**
 * Generate embedding for a single search query
 */
export async function generateSearchEmbedding(
  query: string,
  embeddingModel = 'text-embedding-3-small',
  workspaceId?: string | null,
  ollamaBaseUrl?: string
): Promise<number[]> {
  if (embeddingModel.startsWith('ollama/')) {
    const modelName = embeddingModel.slice(7)
    const baseUrl = getOllamaBaseUrl(ollamaBaseUrl)
    logger.info(`Using Ollama (${baseUrl}) for search embedding with model ${modelName}`)
    const embeddings = await retryWithExponentialBackoff(
      () => callOllamaEmbeddingAPI([query], modelName, baseUrl),
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
    return embeddings[0]
  }

  const config = await getEmbeddingConfig(embeddingModel, workspaceId)

  logger.info(
    `Using ${config.useAzure ? 'Azure OpenAI' : 'OpenAI'} for search embedding generation`
  )

  const embeddings = await callEmbeddingAPI([query], config)
  return embeddings[0]
}
