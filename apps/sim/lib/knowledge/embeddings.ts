import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type BillingAttributionSnapshot,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { env } from '@/lib/core/config/env'
import { embedKnowledge } from '@/lib/embeddings'
import {
  assertKbEmbeddingModel,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  getEmbeddingModelInfo,
  SUPPORTED_EMBEDDING_MODELS,
} from '@/lib/knowledge/embedding-models'
import { projectKnowledgeModelInputs } from '@/lib/knowledge/model-input-provenance'
import { estimateTokenCount } from '@/lib/tokenization'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('EmbeddingUtils')

export { EMBEDDING_DIMENSIONS } from '@/lib/knowledge/embedding-models'

export type EmbeddingInputType = 'document' | 'query'

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
 * Every knowledge-base vector is pinned to {@link EMBEDDING_DIMENSIONS} so it
 * matches the fixed width of the pgvector column.
 */
export async function generateEmbeddings(
  texts: string[],
  embeddingModel: string = DEFAULT_EMBEDDING_MODEL,
  workspaceId?: string | null
): Promise<GenerateEmbeddingsResult> {
  assertKbEmbeddingModel(embeddingModel)

  const result = await embedKnowledge(texts, {
    model: embeddingModel,
    workspaceId,
    taskType: 'document',
    dimensions: EMBEDDING_DIMENSIONS,
    projectInputs: projectKnowledgeModelInputs,
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
  embeddingModel: string = DEFAULT_EMBEDDING_MODEL,
  workspaceId?: string | null
): Promise<{ embedding: number[]; isBYOK: boolean }> {
  assertKbEmbeddingModel(embeddingModel)

  const result = await embedKnowledge([query], {
    model: embeddingModel,
    workspaceId,
    taskType: 'query',
    dimensions: EMBEDDING_DIMENSIONS,
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
