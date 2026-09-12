import { LRUCache } from 'lru-cache'
import { openRouterEmbeddingModelsUpstreamResponseSchema } from '@/lib/api/contracts/providers'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
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

/** Runtime-local caching also works in workers, where Next's fetch cache is unavailable. */
const modelCatalogCache = new LRUCache<string, OpenRouterEmbeddingModelMetadata[]>({
  max: 1,
  ttl: 300_000,
  ttlResolution: 0,
})

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
  signal?.throwIfAborted()
  const cached = modelCatalogCache.get(OPENROUTER_EMBEDDING_MODELS_URL)
  if (cached) return structuredClone(cached)

  const response = await secureFetchWithValidation(OPENROUTER_EMBEDDING_MODELS_URL, {
    profile: 'configuredEndpoint',
    maxResponseBytes: MAX_OPENROUTER_EMBEDDING_CATALOG_BYTES,
    maxRedirects: 20,
    redirectPolicy: { mode: 'standard', sendCredentialsOnCrossOriginRedirect: false },
    headers: { 'Content-Type': 'application/json' },
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
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
  const catalog = Array.from(models.values())
  modelCatalogCache.set(OPENROUTER_EMBEDDING_MODELS_URL, structuredClone(catalog))
  return catalog
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
