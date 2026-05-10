import { createLogger } from '@sim/logger'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env, envNumber } from '@/lib/core/config/env'
import { isRetryableError, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  getEmbeddingModelInfo,
  SUPPORTED_EMBEDDING_MODELS,
  type TokenizerProviderId,
} from '@/lib/knowledge/embedding-models'
import { batchByTokenLimit, estimateTokenCount } from '@/lib/tokenization'

const logger = createLogger('EmbeddingUtils')

const MAX_TOKENS_PER_REQUEST = 8000
const MAX_CONCURRENT_BATCHES = envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 50)
const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000

export { EMBEDDING_DIMENSIONS } from '@/lib/knowledge/embedding-models'

class EmbeddingAPIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'EmbeddingAPIError'
    this.status = status
  }
}

export type EmbeddingInputType = 'document' | 'query'

interface ProviderRequest {
  apiUrl: string
  headers: Record<string, string>
  body: unknown
  parse: (json: unknown) => number[][]
}

interface ResolvedProvider {
  modelName: string
  pricingId: string
  isBYOK: boolean
  /** Tokenizer used to estimate tokens when the API does not return a usage field. */
  tokenizerProvider: TokenizerProviderId
  /** Hard per-request item cap enforced by the provider (e.g. Gemini caps at 100). */
  maxItemsPerRequest?: number
  buildRequest: (inputs: string[], inputType: EmbeddingInputType) => ProviderRequest
}

/** Gemini's `batchEmbedContents` rejects requests with more than 100 items. */
const GEMINI_MAX_ITEMS_PER_REQUEST = 100

async function resolveOpenAIKey(workspaceId?: string | null): Promise<{
  apiKey: string
  isBYOK: boolean
}> {
  if (workspaceId) {
    const byokResult = await getBYOKKey(workspaceId, 'openai')
    if (byokResult) {
      logger.info('Using workspace BYOK key for OpenAI embeddings')
      return { apiKey: byokResult.apiKey, isBYOK: true }
    }
  }
  if (env.OPENAI_API_KEY) {
    return { apiKey: env.OPENAI_API_KEY, isBYOK: false }
  }
  try {
    return { apiKey: getRotatingApiKey('openai'), isBYOK: false }
  } catch {
    throw new Error('OPENAI_API_KEY is not configured')
  }
}

async function resolveGeminiKey(workspaceId?: string | null): Promise<{
  apiKey: string
  isBYOK: boolean
}> {
  if (workspaceId) {
    const byokResult = await getBYOKKey(workspaceId, 'google')
    if (byokResult) {
      logger.info('Using workspace BYOK key for Gemini embeddings')
      return { apiKey: byokResult.apiKey, isBYOK: true }
    }
  }
  if (env.GEMINI_API_KEY) {
    return { apiKey: env.GEMINI_API_KEY, isBYOK: false }
  }
  try {
    return { apiKey: getRotatingApiKey('gemini'), isBYOK: false }
  } catch {
    throw new Error(
      'GEMINI_API_KEY (or GEMINI_API_KEY_1/2/3 for rotation) must be configured for Gemini embeddings'
    )
  }
}

function buildOpenAIProvider(modelName: string, apiKey: string): ResolvedProvider['buildRequest'] {
  return (inputs) => ({
    apiUrl: 'https://api.openai.com/v1/embeddings',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      input: inputs,
      model: modelName,
      encoding_format: 'float',
      dimensions: EMBEDDING_DIMENSIONS,
    },
    parse: (json) => {
      const data = json as { data: Array<{ embedding: number[] }> }
      return data.data.map((item) => item.embedding)
    },
  })
}

function buildAzureOpenAIProvider(
  deployment: string,
  apiKey: string,
  endpoint: string,
  apiVersion: string
): ResolvedProvider['buildRequest'] {
  return (inputs) => ({
    apiUrl: `${endpoint}/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`,
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: {
      input: inputs,
      encoding_format: 'float',
      dimensions: EMBEDDING_DIMENSIONS,
    },
    parse: (json) => {
      const data = json as { data: Array<{ embedding: number[] }> }
      return data.data.map((item) => item.embedding)
    },
  })
}

/**
 * Gemini does NOT auto-normalize embeddings when `outputDimensionality` is set below the
 * native 3072 dimension on `gemini-embedding-001`. Manually L2-normalize so cosine and
 * inner-product similarity work correctly.
 */
function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const v of vector) sumSquares += v * v
  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return vector
  return vector.map((v) => v / norm)
}

function buildGeminiProvider(modelName: string, apiKey: string): ResolvedProvider['buildRequest'] {
  return (inputs, inputType) => ({
    apiUrl: `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:batchEmbedContents`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: {
      requests: inputs.map((text) => ({
        model: `models/${modelName}`,
        content: { parts: [{ text }] },
        taskType: inputType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_DIMENSIONS,
      })),
    },
    parse: (json) => {
      const data = json as { embeddings: Array<{ values: number[] }> }
      return data.embeddings.map((item) => l2Normalize(item.values))
    },
  })
}

/**
 * Returns the embedding model to use for new knowledge bases.
 * Sourced from the `KB_EMBEDDING_MODEL` env var; falls back to the default if
 * unset or set to an unsupported model.
 */
export function getConfiguredEmbeddingModel(): string {
  const configured = env.KB_EMBEDDING_MODEL
  if (configured && SUPPORTED_EMBEDDING_MODELS[configured]) {
    return configured
  }
  if (configured) {
    logger.warn(
      `KB_EMBEDDING_MODEL="${configured}" is not a supported embedding model — falling back to ${DEFAULT_EMBEDDING_MODEL}`
    )
  }
  return DEFAULT_EMBEDDING_MODEL
}

async function resolveProvider(
  embeddingModel: string,
  workspaceId?: string | null
): Promise<ResolvedProvider> {
  const azureApiKey = env.AZURE_OPENAI_API_KEY
  const azureEndpoint = env.AZURE_OPENAI_ENDPOINT
  const azureApiVersion = env.AZURE_OPENAI_API_VERSION
  const isOpenAIModel = SUPPORTED_EMBEDDING_MODELS[embeddingModel]?.provider === 'openai'
  /**
   * Azure deployment names default to the embedding model name when
   * `KB_OPENAI_MODEL_NAME` is unset — this matches the pre-existing
   * convention where deployments are named after the model they host.
   */
  const azureDeploymentName = env.KB_OPENAI_MODEL_NAME || embeddingModel
  const useAzure = Boolean(isOpenAIModel && azureApiKey && azureEndpoint && azureApiVersion)

  const info = getEmbeddingModelInfo(embeddingModel)

  if (useAzure) {
    return {
      modelName: azureDeploymentName,
      pricingId: info.pricingId,
      isBYOK: false,
      tokenizerProvider: info.tokenizerProvider,
      buildRequest: buildAzureOpenAIProvider(
        azureDeploymentName,
        azureApiKey!,
        azureEndpoint!,
        azureApiVersion!
      ),
    }
  }

  if (info.provider === 'openai') {
    const { apiKey, isBYOK } = await resolveOpenAIKey(workspaceId)
    return {
      modelName: embeddingModel,
      pricingId: info.pricingId,
      isBYOK,
      tokenizerProvider: info.tokenizerProvider,
      buildRequest: buildOpenAIProvider(embeddingModel, apiKey),
    }
  }

  if (info.provider === 'gemini') {
    const { apiKey, isBYOK } = await resolveGeminiKey(workspaceId)
    return {
      modelName: embeddingModel,
      pricingId: info.pricingId,
      isBYOK,
      tokenizerProvider: info.tokenizerProvider,
      maxItemsPerRequest: GEMINI_MAX_ITEMS_PER_REQUEST,
      buildRequest: buildGeminiProvider(embeddingModel, apiKey),
    }
  }

  throw new Error(`Unknown embedding provider for model ${embeddingModel}`)
}

async function callEmbeddingAPI(
  inputs: string[],
  provider: ResolvedProvider,
  inputType: EmbeddingInputType
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  return retryWithExponentialBackoff(
    async () => {
      const request = provider.buildRequest(inputs, inputType)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), EMBEDDING_REQUEST_TIMEOUT_MS)

      const response = await fetch(request.apiUrl, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      if (!response.ok) {
        const errorText = await response.text()
        throw new EmbeddingAPIError(
          `Embedding API failed: ${response.status} ${response.statusText} - ${errorText}`,
          response.status
        )
      }

      const json = await response.json()
      const embeddings = request.parse(json)
      const usage = (json as { usage?: { total_tokens?: number } }).usage
      const totalTokens =
        usage?.total_tokens ??
        // Gemini does not return usage.total_tokens — estimate with the provider's tokenizer
        inputs.reduce(
          (sum, text) => sum + estimateTokenCount(text, provider.tokenizerProvider).count,
          0
        )

      return { embeddings, totalTokens }
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

function splitByItemLimit<T>(items: T[], limit: number): T[][] {
  if (items.length <= limit) return [items]
  const result: T[][] = []
  for (let i = 0; i < items.length; i += limit) {
    result.push(items.slice(i, i + limit))
  }
  return result
}

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
  /** Pricing identifier for use with calculateCost / EMBEDDING_MODEL_PRICING. */
  pricingId: string
}

/**
 * Generate embeddings for multiple texts with token-aware batching and parallel processing.
 */
export async function generateEmbeddings(
  texts: string[],
  embeddingModel: string = DEFAULT_EMBEDDING_MODEL,
  workspaceId?: string | null
): Promise<GenerateEmbeddingsResult> {
  const provider = await resolveProvider(embeddingModel, workspaceId)

  const tokenBatches = batchByTokenLimit(texts, MAX_TOKENS_PER_REQUEST, embeddingModel)
  const batches = provider.maxItemsPerRequest
    ? tokenBatches.flatMap((batch) => splitByItemLimit(batch, provider.maxItemsPerRequest!))
    : tokenBatches

  const batchResults = await processWithConcurrency(
    batches,
    MAX_CONCURRENT_BATCHES,
    async (batch, i) => {
      try {
        return await callEmbeddingAPI(batch, provider, 'document')
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
    isBYOK: provider.isBYOK,
    modelName: provider.modelName,
    pricingId: provider.pricingId,
  }
}

/**
 * Generate embedding for a single search query.
 */
export async function generateSearchEmbedding(
  query: string,
  embeddingModel: string = DEFAULT_EMBEDDING_MODEL,
  workspaceId?: string | null
): Promise<number[]> {
  const provider = await resolveProvider(embeddingModel, workspaceId)

  logger.info(`Using ${provider.modelName} for search embedding generation`)

  const { embeddings } = await callEmbeddingAPI([query], provider, 'query')
  return embeddings[0]
}
