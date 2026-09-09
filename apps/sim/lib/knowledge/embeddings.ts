import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type BillingAttributionSnapshot,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { env, envNumber } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { embedKnowledge } from '@/lib/embeddings'
import { isOllamaEmbeddingModel } from '@/lib/embeddings/catalog'
import { EmbeddingInputLimitError } from '@/lib/embeddings/client'
import {
  getOllamaEmbeddingModelMetadata,
  OllamaEmbeddingModelNotFoundError,
  OllamaEmbeddingWidthUnknownError,
} from '@/lib/embeddings/ollama-model-catalog.server'
import type { EmbeddingBatchCheckpoints } from '@/lib/embeddings/types'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import {
  assertKbEmbeddingModel,
  DEFAULT_EMBEDDING_MODEL,
  defaultKbEmbeddingDimensions,
  getEmbeddingModelInfo,
  isKbEmbeddingDimensions,
  isKbEmbeddingModel,
  KB_EMBEDDING_STORAGE_DIMENSIONS,
  type KbEmbeddingDimensions,
} from '@/lib/knowledge/embedding-models'
import { projectKnowledgeModelInputs } from '@/lib/knowledge/model-input-provenance'
import { estimateTokenCount } from '@/lib/tokenization'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('EmbeddingUtils')

export type EmbeddingInputType = 'document' | 'query'

/**
 * The model a knowledge base is indexed with and the vector width it stores.
 * The two travel together everywhere: a width is only meaningful for the model
 * that emits it, and a chunk written at the wrong width lands in the wrong
 * pgvector column or none at all.
 */
export interface KbEmbeddingTarget {
  model: string
  dimensions: KbEmbeddingDimensions
}

/**
 * Returns the embedding model to use for new knowledge bases.
 * Sourced from the `KB_EMBEDDING_MODEL` env var; falls back to the default if
 * unset or set to a model knowledge bases cannot use.
 */
function resolveConfiguredEmbeddingModel(): string {
  const configured = env.KB_EMBEDDING_MODEL
  if (configured && isKbEmbeddingModel(configured)) {
    return configured
  }
  if (configured) {
    logger.warn(
      `KB_EMBEDDING_MODEL="${configured}" is not a supported embedding model — falling back to ${DEFAULT_EMBEDDING_MODEL}`
    )
  }
  return DEFAULT_EMBEDDING_MODEL
}

/**
 * Vector width new knowledge bases are stored at, from `EMBEDDING_OUTPUT_DIMS`.
 *
 * Matching the width to what the configured model actually emits is the
 * operator's job — Sim cannot verify it for a model on their own Ollama server,
 * and for a catalogued model it can only check the widths the provider
 * documents. Either way a value this deployment cannot store falls back rather
 * than failing knowledge-base creation outright, because a base that exists at
 * a working width is recoverable and one that could not be created is not.
 */
function resolveConfiguredEmbeddingDimensions(model: string): KbEmbeddingDimensions {
  const raw = env.EMBEDDING_OUTPUT_DIMS
  if (raw === undefined || String(raw).trim() === '') return defaultKbEmbeddingDimensions(model)

  const fallback = defaultKbEmbeddingDimensions(model)
  /**
   * Read through `envNumber` rather than trusted as the number its schema
   * declares: `createEnv` runs with `skipValidation`, so the declared
   * `z.coerce.number()` never executes and the value arrives as the raw string
   * from the environment. Comparing that string against the storage widths
   * matches nothing, which silently ignored every configured width. `0` is the
   * sentinel for a value that is not a number at all; no storage width is 0.
   */
  const configured = envNumber(raw, 0, { min: 1, integer: true })
  if (!isKbEmbeddingDimensions(configured)) {
    logger.warn(
      `EMBEDDING_OUTPUT_DIMS="${raw}" is not a storable vector width — falling back to ${fallback}. Supported: ${KB_EMBEDDING_STORAGE_DIMENSIONS.join(', ')}`
    )
    return fallback
  }
  if (!getEmbeddingModelInfo(model).dimensions.includes(configured)) {
    logger.warn(
      `EMBEDDING_OUTPUT_DIMS="${raw}" is not a width ${model} can emit — falling back to ${fallback}`
    )
    return fallback
  }
  return configured
}

/**
 * Model and vector width every knowledge base created on this deployment uses.
 *
 * Asynchronous for one case: an Ollama model whose width the deployment did not
 * state. Sim can read that from the server the model is installed on, and doing
 * so is much better than the platform default, which would silently create every
 * base at 1,536 and fail each document against a 768-wide model.
 */
export async function getConfiguredKbEmbedding(): Promise<KbEmbeddingTarget> {
  const model = resolveConfiguredEmbeddingModel()
  const configured = env.EMBEDDING_OUTPUT_DIMS
  const stated = configured !== undefined && String(configured).trim() !== ''

  /**
   * An Ollama model's width is a property of what the operator pulled, and the
   * adapter cannot ask for a different one, so there is no width to fall back
   * to: the platform default would pin every base to 1,536 and fail every
   * document against a model that emits anything else. When it cannot be
   * established the base is refused instead, which is recoverable — a base
   * created at an impossible width is not.
   */
  if (isOllamaEmbeddingModel(model) && !stated) {
    let dimensions: number
    try {
      dimensions = (await getOllamaEmbeddingModelMetadata(model)).dimensions
    } catch (error) {
      /**
       * A model the server does not have, or one whose width it will not report,
       * is the operator's to fix and is surfaced as such. An unreachable server
       * is a dependency failure and keeps its default classification — the
       * orchestration vocabulary has no upstream-failure code, and the message
       * carries the cause either way.
       */
      const message = `Could not read the vector width of ${model} from the configured Ollama server (${getErrorMessage(error, 'Unknown error')}). Set EMBEDDING_OUTPUT_DIMS to the width it emits.`
      if (
        error instanceof OllamaEmbeddingModelNotFoundError ||
        error instanceof OllamaEmbeddingWidthUnknownError
      ) {
        throw new OrchestrationError('validation', message)
      }
      throw new Error(message, { cause: error })
    }
    if (!isKbEmbeddingDimensions(dimensions)) {
      throw new OrchestrationError(
        'validation',
        `${model} emits ${dimensions}-dimensional vectors, which knowledge bases cannot store. Choose a model emitting one of ${KB_EMBEDDING_STORAGE_DIMENSIONS.join(', ')}.`
      )
    }
    return { model, dimensions }
  }

  return { model, dimensions: resolveConfiguredEmbeddingDimensions(model) }
}

export interface GenerateEmbeddingsResult {
  embeddings: number[][]
  totalTokens: number
  billableTokens: number
  isBYOK: boolean
  modelName: string
  /** Pricing identifier for use with calculateCost / EMBEDDING_MODEL_PRICING. */
  pricingId: string
}

/**
 * Generate embeddings for multiple texts with token-aware batching and parallel processing.
 *
 * Every vector is pinned to the width its knowledge base was created at, so it
 * matches the pgvector column the base stores into.
 */
export async function generateEmbeddings(
  texts: string[],
  target: KbEmbeddingTarget,
  workspaceId?: string | null,
  signal?: AbortSignal,
  checkpoints?: EmbeddingBatchCheckpoints
): Promise<GenerateEmbeddingsResult> {
  assertKbEmbeddingModel(target.model, target.dimensions)

  const result = await embedKnowledge(texts, {
    model: target.model,
    workspaceId,
    taskType: 'document',
    checkpoints,
    inputOverflow: 'reject',
    dimensions: target.dimensions,
    projectInputs: projectKnowledgeModelInputs,
    signal,
  }).catch((error: unknown) => {
    if (error instanceof EmbeddingInputLimitError) {
      throw new PermanentDocumentProcessingError('document_complexity_limit', error.message, error)
    }
    throw error
  })

  return {
    embeddings: result.embeddings,
    totalTokens: result.totalTokens,
    billableTokens: result.billableTokens,
    isBYOK: result.isBYOK,
    modelName: result.modelName,
    pricingId: result.pricingId,
  }
}

export async function generateSearchEmbedding(
  query: string,
  target: KbEmbeddingTarget,
  workspaceId?: string | null,
  signal?: AbortSignal
): Promise<{ embedding: number[]; isBYOK: boolean }> {
  assertKbEmbeddingModel(target.model, target.dimensions)

  const result = await embedKnowledge([query], {
    model: target.model,
    workspaceId,
    taskType: 'query',
    dimensions: target.dimensions,
    signal,
    projectInputs: projectKnowledgeModelInputs,
  })

  logger.info(`Using ${result.modelName} for search embedding generation`)

  return { embedding: result.embeddings[0], isBYOK: result.isBYOK }
}

/**
 * Records a query embedding's hosted-key cost for callers that generate a search
 * embedding directly, outside the metered `/api/knowledge/search` route (e.g. the
 * v1 search API and copilot KB search). No-ops for BYOK (no Sim cost) or when
 * there is no workspace to attribute to. Best-effort: never throws.
 */
export async function recordSearchEmbeddingUsage(params: {
  userId: string
  workspaceId?: string | null
  embeddingModel: string
  query: string
  isBYOK: boolean
  sourceReference: string
  billingAttribution?: BillingAttributionSnapshot
}): Promise<void> {
  const {
    userId,
    workspaceId,
    embeddingModel,
    query,
    isBYOK,
    sourceReference,
    billingAttribution: providedBillingAttribution,
  } = params
  if (isBYOK || !workspaceId) return
  try {
    const { count } = estimateTokenCount(
      query,
      getEmbeddingModelInfo(embeddingModel).tokenizerProvider
    )
    const cost = calculateCost(embeddingModel, count, 0, false)
    if (!cost || cost.total <= 0) return
    if (!providedBillingAttribution) {
      throw new Error('Billing attribution is required for workspace search embedding usage')
    }
    const billingAttribution = providedBillingAttribution
    if (
      billingAttribution.workspaceId !== workspaceId ||
      billingAttribution.actorUserId !== userId
    ) {
      throw new Error('Search embedding billing attribution does not match its actor and workspace')
    }
    await recordUsage({
      userId: billingAttribution.actorUserId,
      workspaceId,
      ...toBillingContext(billingAttribution),
      entries: [
        {
          category: 'model',
          source: 'knowledge-base',
          description: embeddingModel,
          cost: cost.total,
          sourceReference,
        },
      ],
    })
    await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
  } catch (error) {
    logger.warn('Failed to record search embedding usage', { error: getErrorMessage(error) })
  }
}
