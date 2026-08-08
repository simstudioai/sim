import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env, envNumber } from '@/lib/core/config/env'
import {
  type FallbackFactories,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  wireFallback,
} from '@/lib/core/config/env-capabilities'
import { isHosted } from '@/lib/core/config/env-flags'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingModelInfo,
  getEmbeddingModelInfo,
  hasApproximateTokenCount,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
import { resolveProviderKey } from '@/lib/embeddings/keys'
import { DEFAULT_OPENROUTER_EMBEDDING_MODEL } from '@/lib/embeddings/openrouter-models'
import { getAdapterFactory } from '@/lib/embeddings/providers'
import type {
  EmbeddingProviderAdapter,
  EmbeddingTaskType,
  EmbedOptions,
  EmbedResult,
  OpenRouterEmbedOptions,
} from '@/lib/embeddings/types'
import { isRetryableError, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import { batchByTokenLimit, estimateTokenCount, truncateToTokenLimit } from '@/lib/tokenization'

const logger = createLogger('EmbeddingClient')

const MAX_CONCURRENT_BATCHES = envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 50)
const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000

/**
 * Tokens this client aims to put in one request. Not a provider limit — every
 * provider accepts at least this much, and OpenAI documents 300,000 — but the
 * batch size the knowledge-base indexing path has run on in production.
 *
 * Kept here rather than raised to each provider's maximum so a request stays
 * comfortably inside {@link EMBEDDING_REQUEST_TIMEOUT_MS}: a timed-out batch is
 * retried three times, so large batches make a slow provider expensive to fail
 * against. Raising this trades fewer round trips for costlier retries.
 */
const BATCH_TOKEN_TARGET = 8192

export class EmbeddingAPIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'EmbeddingAPIError'
    this.status = status
  }
}

export function isTransientEmbeddingError(error: unknown): boolean {
  if (error instanceof EmbeddingAPIError) {
    return error.status === 429 || error.status >= 500
  }
  if (error instanceof Error && error.name === 'AbortError') return true
  return isRetryableError(error)
}

interface ResolvedProvider {
  adapter: EmbeddingProviderAdapter
  info: EmbeddingModelInfo
  /** Model name as sent to the provider (an Azure deployment name when Azure is active). */
  modelName: string
  /** Dimensionality the request will produce, for reporting and billing. */
  dimensions: number
  isBYOK: boolean
}

/**
 * Azure OpenAI takes over for OpenAI models when fully configured, but only
 * when the caller has not supplied its own key. A user-pasted OpenAI key must
 * always go to OpenAI.
 */
function resolveAzureOverride(info: EmbeddingModelInfo, model: string) {
  if (info.provider !== 'openai') return null
  const apiKey = env.AZURE_OPENAI_API_KEY
  const endpoint = env.AZURE_OPENAI_ENDPOINT
  const apiVersion = env.AZURE_OPENAI_API_VERSION
  if (!apiKey || !endpoint || !apiVersion) return null
  /**
   * Azure deployment names default to the embedding model name when
   * `KB_OPENAI_MODEL_NAME` is unset — this matches the pre-existing
   * convention where deployments are named after the model they host.
   */
  return { apiKey, endpoint, apiVersion, deployment: env.KB_OPENAI_MODEL_NAME || model }
}

async function resolveProvider(model: string, options: EmbedOptions): Promise<ResolvedProvider> {
  const info = getEmbeddingModelInfo(model)
  const dimensions = resolveDimensions(info, options.dimensions)

  if (options.transport === 'openrouter') {
    if (info.provider !== 'openai') {
      throw new Error(`OpenRouter transport does not support catalog provider: ${info.provider}`)
    }
    if (!options.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured')
    }
    return {
      adapter: getAdapterFactory('openrouter')({
        modelName: model,
        apiKey: options.apiKey,
        nativeDimensions: info.nativeDimensions,
      }),
      info,
      modelName: model,
      dimensions,
      isBYOK: true,
    }
  }

  if (!options.apiKey) {
    const azure = resolveAzureOverride(info, model)
    if (azure) {
      return {
        adapter: getAdapterFactory('azure-openai')({
          modelName: azure.deployment,
          apiKey: azure.apiKey,
          nativeDimensions: info.nativeDimensions,
          endpoint: azure.endpoint,
          apiVersion: azure.apiVersion,
        }),
        info,
        modelName: azure.deployment,
        dimensions,
        isBYOK: false,
      }
    }
  }

  const { apiKey, isBYOK } = options.apiKey
    ? { apiKey: options.apiKey, isBYOK: true }
    : await resolveProviderKey(info.provider, options.workspaceId)

  return {
    adapter: getAdapterFactory(info.provider)({
      modelName: model,
      apiKey,
      nativeDimensions: info.nativeDimensions,
    }),
    info,
    modelName: model,
    dimensions,
    isBYOK,
  }
}

/** `inputs` are already projected and batched by the embedding orchestrator. */
async function callEmbeddingAPI(
  inputs: string[],
  adapter: EmbeddingProviderAdapter,
  tokenizerProvider: string,
  taskType: EmbeddingTaskType,
  /**
   * The caller's explicit reduction, or undefined when none was requested. Kept
   * distinct from `provider.dimensions` because a model without Matryoshka
   * support rejects the parameter outright — sending it populated with the
   * native size is a 400, not a no-op.
   */
  requestedDimensions: number | undefined
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  return retryWithExponentialBackoff(
    async () => {
      const request = adapter.buildRequest({
        inputs,
        taskType,
        dimensions: requestedDimensions,
      })

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
      /**
       * Fallback for a response that carries no usage block. Estimated with the
       * provider's own tokenizer, which is approximate for every non-OpenAI
       * model — see {@link hasApproximateTokenCount}.
       */
      const totalTokens =
        request.parseTokens?.(json) ??
        inputs.reduce((sum, text) => sum + estimateTokenCount(text, tokenizerProvider).count, 0)

      return { embeddings, totalTokens }
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryCondition: isTransientEmbeddingError,
    }
  )
}

interface EmbeddingInputLimits {
  maxInputTokens: number
  maxTokensPerRequest?: number
  tokenizerProvider: string
  approximateTokenCount: boolean
}

function getEmbeddingInputLimits(info: EmbeddingModelInfo): EmbeddingInputLimits {
  return {
    maxInputTokens: info.maxInputTokens,
    maxTokensPerRequest: info.maxTokensPerRequest,
    tokenizerProvider: info.tokenizerProvider,
    approximateTokenCount: hasApproximateTokenCount(info),
  }
}

function prepareEmbeddingInputs(
  texts: string[],
  model: string,
  limits: EmbeddingInputLimits,
  projectInputs: EmbedOptions['projectInputs']
): string[] {
  /**
   * Projected before batching, not after. The projector rewrites resolved-secret
   * plaintext to placeholders, which changes length, and `batchByTokenLimit`
   * measures and truncates whatever it is handed. Batching the pre-projection
   * text would size against a different string than the one actually sent: a
   * lengthening projection then exceeds the model's ceiling and the provider
   * rejects it, and a shortening one discards content that would have fit.
   *
   * Doing it here also keeps projection to exactly once per call, so no retry
   * can re-project already-projected content.
   */
  const modelInputs = projectInputs ? projectInputs(texts) : texts

  /**
   * Each input is held to the model's own per-input ceiling, exactly as declared.
   * One shared constant sent oversized input to models with a lower limit and
   * discarded content models with a higher one accept; discounting the ceiling
   * to absorb tokenizer error would reintroduce the second harm.
   *
   * Truncation happens here rather than inside `batchByTokenLimit` so it occurs
   * once, against the right limit, and is always warned about: a shortened
   * embedding input is otherwise indistinguishable from a good one, both to the
   * caller and in the vector it produces.
   */
  const ceiling = limits.maxInputTokens
  const boundedInputs = modelInputs.map((text) => {
    if (estimateTokenCount(text, limits.tokenizerProvider).count <= ceiling) return text
    logger.warn('Embedding input exceeds the model token limit and will be truncated', {
      model,
      maxInputTokens: ceiling,
      chars: text.length,
      approximateTokenCount: limits.approximateTokenCount,
    })
    return truncateToTokenLimit(text, ceiling, model)
  })

  return boundedInputs
}

async function embedWithProvider(
  boundedInputs: string[],
  model: string,
  taskType: EmbeddingTaskType,
  requestedDimensions: number | undefined,
  provider: ResolvedProvider
): Promise<EmbedResult> {
  const batches = createEmbeddingBatches(
    boundedInputs,
    model,
    getEmbeddingInputLimits(provider.info),
    provider.adapter.maxItemsPerRequest
  )

  const batchResults = await mapWithConcurrency(
    batches,
    MAX_CONCURRENT_BATCHES,
    async (batch, i) => {
      try {
        return await callEmbeddingAPI(
          batch,
          provider.adapter,
          provider.info.tokenizerProvider,
          taskType,
          requestedDimensions
        )
      } catch (error) {
        logger.error(`Failed to generate embeddings for batch ${i + 1}/${batches.length}:`, error)
        throw error
      }
    }
  )

  const { embeddings, totalTokens } = combineEmbeddingBatches(batchResults)

  return {
    embeddings,
    totalTokens,
    billableTokens: provider.isBYOK ? 0 : totalTokens,
    isBYOK: provider.isBYOK,
    modelName: provider.modelName,
    pricingId: provider.info.pricingId,
    dimensions: provider.dimensions,
  }
}

function createEmbeddingBatches(
  boundedInputs: string[],
  model: string,
  limits: Pick<EmbeddingInputLimits, 'maxInputTokens' | 'maxTokensPerRequest'>,
  itemLimit: number | undefined
): string[][] {
  const ceiling = limits.maxInputTokens

  /**
   * How many tokens may share one request — a different limit from the per-input
   * ceiling above, and the one that decides how many inputs go in a batch.
   *
   * Three bounds compose here:
   *
   * 1. {@link BATCH_TOKEN_TARGET} is what we actually aim for — an operational
   *    choice, not a provider limit (see its declaration for the reasoning).
   * 2. A provider's documented summed-token cap, when it publishes one, is a
   *    hard ceiling the target can never exceed.
   * 3. The per-input ceiling is a floor. A budget below it would make
   *    `batchByTokenLimit` truncate inputs the provider would have accepted —
   *    Cohere takes 128k tokens in one text, far above the target.
   */
  const requestBudget = Math.max(
    Math.min(limits.maxTokensPerRequest ?? BATCH_TOKEN_TARGET, BATCH_TOKEN_TARGET),
    ceiling
  )

  const tokenBatches = batchByTokenLimit(boundedInputs, requestBudget, model)
  return itemLimit ? tokenBatches.flatMap((batch) => chunkArray(batch, itemLimit)) : tokenBatches
}

function combineEmbeddingBatches(
  batchResults: readonly { embeddings: number[][]; totalTokens: number }[]
): { embeddings: number[][]; totalTokens: number } {
  const embeddings: number[][] = []
  let totalTokens = 0
  for (const batch of batchResults) {
    for (const vector of batch.embeddings) {
      embeddings.push(vector)
    }
    totalTokens += batch.totalTokens
  }
  return { embeddings, totalTokens }
}

/**
 * Generates embeddings for a batch of texts with token-aware batching,
 * per-provider item caps, bounded concurrency, and retry on transient failures.
 */
export async function embed(texts: string[], options: EmbedOptions): Promise<EmbedResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const taskType = options.taskType ?? 'document'
  const provider = await resolveProvider(model, options)
  const boundedInputs = prepareEmbeddingInputs(
    texts,
    model,
    getEmbeddingInputLimits(provider.info),
    options.projectInputs
  )
  return embedWithProvider(boundedInputs, model, taskType, options.dimensions, provider)
}

/** Generates embeddings for any model returned by OpenRouter's embedding catalog. */
export async function embedOpenRouter(
  texts: string[],
  options: OpenRouterEmbedOptions
): Promise<EmbedResult> {
  if (texts.length === 0) throw new Error('At least one embedding input is required')
  if (!options.apiKey) throw new Error('OpenRouter API key is required')
  if (!Number.isInteger(options.maxInputTokens) || options.maxInputTokens <= 0) {
    throw new Error('OpenRouter max input tokens must be a positive integer')
  }

  const model = options.model ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL
  const limits: EmbeddingInputLimits = {
    maxInputTokens: options.maxInputTokens,
    tokenizerProvider: 'openrouter',
    approximateTokenCount: true,
  }
  const boundedInputs = prepareEmbeddingInputs(texts, model, limits, options.projectInputs)
  const adapter = getAdapterFactory('openrouter')({
    modelName: model,
    apiKey: options.apiKey,
    nativeDimensions: options.dimensions ?? 0,
  })
  const batches = createEmbeddingBatches(boundedInputs, model, limits, adapter.maxItemsPerRequest)
  const batchResults = await mapWithConcurrency(batches, MAX_CONCURRENT_BATCHES, async (batch) =>
    callEmbeddingAPI(batch, adapter, limits.tokenizerProvider, 'document', options.dimensions)
  )
  const result = combineEmbeddingBatches(batchResults)

  if (result.embeddings.length !== boundedInputs.length) {
    throw new Error(
      `OpenRouter returned ${result.embeddings.length} embeddings for ${boundedInputs.length} inputs`
    )
  }
  const dimensions = result.embeddings[0]?.length
  if (!dimensions) throw new Error('OpenRouter returned an empty embedding vector')
  if (result.embeddings.some((embedding) => embedding.length !== dimensions)) {
    throw new Error('OpenRouter returned embedding vectors with inconsistent dimensions')
  }
  if (options.dimensions !== undefined && dimensions !== options.dimensions) {
    throw new Error(
      `OpenRouter returned ${dimensions} dimensions instead of the requested ${options.dimensions}`
    )
  }

  return {
    embeddings: result.embeddings,
    totalTokens: result.totalTokens,
    billableTokens: 0,
    isBYOK: true,
    modelName: model,
    pricingId: model,
    dimensions,
  }
}

type KnowledgeEmbedOptions = Omit<EmbedOptions, 'apiKey' | 'transport'>

function resolveEnvironmentOpenAIKey(): string {
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY
  return getRotatingApiKey('openai')
}

/** @internal Exported for deterministic hosted/self-hosted routing tests. */
export async function embedKnowledgeForDeployment(
  texts: string[],
  options: KnowledgeEmbedOptions,
  hosted: boolean
): Promise<EmbedResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const info = getEmbeddingModelInfo(model)
  if (hosted || !env.OPENROUTER_API_KEY || info.provider !== 'openai') {
    return embed(texts, options)
  }

  const dimensions = resolveDimensions(info, options.dimensions)
  const taskType = options.taskType ?? 'document'
  const boundedInputs = prepareEmbeddingInputs(
    texts,
    model,
    getEmbeddingInputLimits(info),
    options.projectInputs
  )
  const workspaceKey = options.workspaceId ? await getBYOKKey(options.workspaceId, 'openai') : null
  const capabilityValues = workspaceKey ? { ...env, OPENAI_API_KEY: workspaceKey.apiKey } : env

  const factories = {
    'azure-openai': () => {
      const azure = resolveAzureOverride(info, model)
      if (!azure) return null
      return {
        adapter: getAdapterFactory('azure-openai')({
          modelName: azure.deployment,
          apiKey: azure.apiKey,
          nativeDimensions: info.nativeDimensions,
          endpoint: azure.endpoint,
          apiVersion: azure.apiVersion,
        }),
        info,
        modelName: azure.deployment,
        dimensions,
        isBYOK: false,
      }
    },
    openai: () => {
      const apiKey = workspaceKey?.apiKey ?? resolveEnvironmentOpenAIKey()
      return {
        adapter: getAdapterFactory('openai')({
          modelName: model,
          apiKey,
          nativeDimensions: info.nativeDimensions,
        }),
        info,
        modelName: model,
        dimensions,
        isBYOK: Boolean(workspaceKey),
      }
    },
    openrouter: () => {
      if (!env.OPENROUTER_API_KEY) return null
      return {
        adapter: getAdapterFactory('openrouter')({
          modelName: model,
          apiKey: env.OPENROUTER_API_KEY,
          nativeDimensions: info.nativeDimensions,
        }),
        info,
        modelName: model,
        dimensions,
        isBYOK: false,
      }
    },
  } satisfies FallbackFactories<typeof KNOWLEDGE_EMBEDDINGS_CAPABILITY, ResolvedProvider>

  const fallback = wireFallback<typeof KNOWLEDGE_EMBEDDINGS_CAPABILITY, ResolvedProvider>({
    definition: KNOWLEDGE_EMBEDDINGS_CAPABILITY,
    values: capabilityValues,
    factories,
    shouldFallback: isTransientEmbeddingError,
    onFailure(providerId, error) {
      logger.warn('Knowledge embedding provider failed; continuing fallback chain', {
        providerId,
        error,
      })
    },
  })

  const itemLimits = fallback.providers.flatMap((provider) =>
    provider.adapter.maxItemsPerRequest ? [provider.adapter.maxItemsPerRequest] : []
  )
  const batches = createEmbeddingBatches(
    boundedInputs,
    model,
    info,
    itemLimits.length > 0 ? Math.min(...itemLimits) : undefined
  )
  const batchResults = await mapWithConcurrency(
    batches,
    MAX_CONCURRENT_BATCHES,
    async (batch, i) => {
      try {
        return await fallback.execute(async (provider) => ({
          ...(await callEmbeddingAPI(
            batch,
            provider.adapter,
            provider.info.tokenizerProvider,
            taskType,
            options.dimensions
          )),
          provider,
        }))
      } catch (error) {
        logger.error(`Failed to generate embeddings for batch ${i + 1}/${batches.length}:`, error)
        throw error
      }
    }
  )
  const { embeddings, totalTokens } = combineEmbeddingBatches(batchResults)
  const defaultProvider = fallback.providers[0]
  const usedProviders = batchResults.map((batch) => batch.provider)
  const metadataProvider = usedProviders[0] ?? defaultProvider
  const modelNames = new Set(usedProviders.map((provider) => provider.modelName))
  const billableTokens = batchResults.reduce(
    (sum, batch) => sum + (batch.provider.isBYOK ? 0 : batch.totalTokens),
    0
  )

  return {
    embeddings,
    totalTokens,
    billableTokens,
    isBYOK: usedProviders.length > 0 ? billableTokens === 0 : metadataProvider.isBYOK,
    modelName: modelNames.size > 1 ? model : metadataProvider.modelName,
    pricingId: info.pricingId,
    dimensions,
  }
}

/** Generates KB document/query embeddings with opt-in self-hosted OpenRouter fallback. */
export async function embedKnowledge(
  texts: string[],
  options: KnowledgeEmbedOptions
): Promise<EmbedResult> {
  return embedKnowledgeForDeployment(texts, options, isHosted)
}
