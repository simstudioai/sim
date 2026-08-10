import { openRouterEmbeddingModelsUpstreamResponseSchema } from '@/lib/api/contracts/providers'
import {
  toOpenRouterEmbeddingModelId,
  toOpenRouterWireEmbeddingModelId,
} from '@/lib/embeddings/openrouter-models'

const OPENROUTER_EMBEDDING_MODELS_URL = 'https://openrouter.ai/api/v1/embeddings/models'

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
export async function fetchOpenRouterEmbeddingModelCatalog(): Promise<
  OpenRouterEmbeddingModelMetadata[]
> {
  const response = await fetch(OPENROUTER_EMBEDDING_MODELS_URL, {
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: 300 },
  })
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenRouter embedding models: ${response.status} ${response.statusText}`
    )
  }

  const data = openRouterEmbeddingModelsUpstreamResponseSchema.parse(await response.json())
  const models = new Map<string, OpenRouterEmbeddingModelMetadata>()
  for (const model of data.data) {
    const id = toOpenRouterEmbeddingModelId(model.id)
    models.set(id, { id, maxInputTokens: model.context_length })
  }
  return Array.from(models.values())
}

/** Resolves and validates one selected model against OpenRouter's live catalog. */
export async function getOpenRouterEmbeddingModelMetadata(
  model: string
): Promise<OpenRouterEmbeddingModelMetadata> {
  const normalizedId = toOpenRouterEmbeddingModelId(toOpenRouterWireEmbeddingModelId(model))
  const metadata = (await fetchOpenRouterEmbeddingModelCatalog()).find(
    (candidate) => candidate.id === normalizedId
  )
  if (!metadata) throw new OpenRouterEmbeddingModelNotFoundError(model)
  return metadata
}
