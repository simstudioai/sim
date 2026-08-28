import { openRouterEmbeddingModelsUpstreamResponseSchema } from '@/lib/api/contracts/providers'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  toOpenRouterEmbeddingModelId,
  toOpenRouterWireEmbeddingModelId,
} from '@/lib/embeddings/openrouter-models'

const OPENROUTER_EMBEDDING_MODELS_URL = 'https://openrouter.ai/api/v1/embeddings/models'
const MAX_OPENROUTER_EMBEDDING_CATALOG_BYTES = 4 * 1024 * 1024

export interface OpenRouterEmbeddingModelMetadata {
  id: string
  maxInputTokens: number
}

export class OpenRouterEmbeddingModelNotFoundError extends Error {
  constructor(model: string) {
    super(`Unsupported OpenRouter embedding model: ${model}`)
    this.name = 'OpenRouterEmbeddingModelNotFoundError'
  }
}

/** Loads OpenRouter's current embedding-only catalog with its input ceilings. */
export async function fetchOpenRouterEmbeddingModelCatalog(
  signal?: AbortSignal
): Promise<OpenRouterEmbeddingModelMetadata[]> {
  const response = await fetch(OPENROUTER_EMBEDDING_MODELS_URL, {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 300 },
    signal,
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenRouter embedding models: ${response.status} ${response.statusText}`
    )
  }

  const data = openRouterEmbeddingModelsUpstreamResponseSchema.parse(
    await readResponseJsonWithLimit(response, {
      maxBytes: MAX_OPENROUTER_EMBEDDING_CATALOG_BYTES,
      label: 'OpenRouter embedding model catalog',
      signal,
    })
  )
  const models = new Map<string, OpenRouterEmbeddingModelMetadata>()
  for (const model of data.data) {
    const id = toOpenRouterEmbeddingModelId(model.id)
    models.set(id, { id, maxInputTokens: model.context_length })
  }
  return Array.from(models.values())
}

/** Resolves and validates one selected model against OpenRouter's live catalog. */
export async function getOpenRouterEmbeddingModelMetadata(
  model: string,
  signal?: AbortSignal
): Promise<OpenRouterEmbeddingModelMetadata> {
  const normalizedId = toOpenRouterEmbeddingModelId(toOpenRouterWireEmbeddingModelId(model))
  const metadata = (await fetchOpenRouterEmbeddingModelCatalog(signal)).find(
    (candidate) => candidate.id === normalizedId
  )
  if (!metadata) throw new OpenRouterEmbeddingModelNotFoundError(model)
  return metadata
}
