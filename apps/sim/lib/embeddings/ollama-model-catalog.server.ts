import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ollamaShowUpstreamResponseSchema,
  ollamaUpstreamResponseSchema,
} from '@/lib/api/contracts/providers'
import { isHosted } from '@/lib/core/config/env-flags'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { getOllamaUrl, isOllamaUrlConfigured } from '@/lib/core/utils/urls'
import { isOllamaEmbeddingModel, ollamaEmbeddingModelName } from '@/lib/embeddings/catalog'

const logger = createLogger('OllamaEmbeddingCatalog')

const MAX_OLLAMA_CATALOG_BYTES = 4 * 1024 * 1024

/** `/api/show` is one request per installed model, so the fan-out is bounded. */
const OLLAMA_SHOW_CONCURRENCY = 6

/** Suffix every architecture uses for the width it emits (`bert.embedding_length`). */
const EMBEDDING_LENGTH_SUFFIX = '.embedding_length'

export interface OllamaEmbeddingModel {
  /** Name as Ollama lists it, tag included (`nomic-embed-text:latest`). */
  id: string
  /** Width the model emits, when its architecture publishes one. */
  dimensions?: number
}

export class OllamaEmbeddingModelNotFoundError extends Error {
  constructor(model: string) {
    super(
      `Unsupported Ollama embedding model: ${model}. Pull it on the configured Ollama server first.`
    )
    this.name = 'OllamaEmbeddingModelNotFoundError'
  }
}

export class OllamaEmbeddingWidthUnknownError extends Error {
  constructor(model: string) {
    super(
      `Ollama did not report an embedding width for ${model}, so Sim cannot verify what it returns. Upgrade Ollama or choose another model.`
    )
    this.name = 'OllamaEmbeddingWidthUnknownError'
  }
}

async function fetchOllamaJson(path: string, init: RequestInit, signal?: AbortSignal) {
  const response = await fetch(`${getOllamaUrl().replace(/\/+$/, '')}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    signal,
    ...init,
  })
  if (!response.ok) {
    throw new Error(`Ollama ${path} failed: ${response.status} ${response.statusText}`)
  }
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_OLLAMA_CATALOG_BYTES,
    label: `Ollama ${path} response`,
    signal,
  })
}

function readEmbeddingLength(modelInfo: Record<string, unknown> | undefined): number | undefined {
  if (!modelInfo) return undefined
  for (const [key, value] of Object.entries(modelInfo)) {
    if (!key.endsWith(EMBEDDING_LENGTH_SUFFIX)) continue
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  }
  return undefined
}

/**
 * Embedding-capable models installed on the deployment's Ollama, with the width
 * each one emits.
 *
 * `/api/tags` lists chat and embedding models together and distinguishes
 * neither, so every entry is resolved through `/api/show`, whose `capabilities`
 * is the only thing that says which is which. A model that reports no
 * capabilities at all (Ollama older than 0.5) is kept rather than dropped:
 * hiding a usable model on an older server is worse than offering one the user
 * has to recognise as a chat model.
 *
 * Returns an empty list rather than throwing when no Ollama is configured or
 * reachable, mirroring `/api/providers/ollama/models` — an absent Ollama is a
 * normal deployment shape, not a failure of this lookup.
 */
export async function fetchOllamaEmbeddingModelCatalog(
  signal?: AbortSignal
): Promise<OllamaEmbeddingModel[]> {
  /**
   * Hosted Sim runs no Ollama, and the loopback default cannot answer there, so
   * an unconfigured hosted deployment is not dialled at all. An explicit
   * `OLLAMA_URL` states an intent to reach a real server and is still honoured.
   */
  if (isHosted && !isOllamaUrlConfigured()) return []

  let names: string[]
  try {
    const tags = ollamaUpstreamResponseSchema.parse(
      await fetchOllamaJson('/api/tags', { method: 'GET' }, signal)
    )
    names = tags.models.map((model) => model.name)
  } catch (error) {
    signal?.throwIfAborted()
    logger.info('Ollama is not reachable; offering no embedding models', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return []
  }

  const resolved = await mapWithConcurrency(names, OLLAMA_SHOW_CONCURRENCY, async (name) => {
    try {
      const detail = ollamaShowUpstreamResponseSchema.parse(
        await fetchOllamaJson(
          '/api/show',
          { method: 'POST', body: JSON.stringify({ model: name }) },
          signal
        )
      )
      if (detail.capabilities && !detail.capabilities.includes('embedding')) return null
      const dimensions = readEmbeddingLength(detail.model_info)
      return { id: name, ...(dimensions !== undefined ? { dimensions } : {}) }
    } catch (error) {
      signal?.throwIfAborted()
      /** One unreadable model must not hide the rest of the server's catalog. */
      logger.info('Skipping an Ollama model that could not be inspected', {
        model: name,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return null
    }
  })

  return resolved.filter((model): model is OllamaEmbeddingModel => model !== null)
}

/**
 * Resolves one selected model against the server's live catalog, the way the
 * OpenRouter tool resolves a model against OpenRouter's.
 *
 * The width is required rather than optional because it is what the client
 * validates the response against. Without it a model that quietly returns a
 * different size than the caller expects would be indistinguishable from a good
 * one — the exact failure the knowledge-base path names both numbers for.
 */
export async function getOllamaEmbeddingModelMetadata(
  model: string,
  signal?: AbortSignal
): Promise<Required<OllamaEmbeddingModel>> {
  const name = isOllamaEmbeddingModel(model) ? ollamaEmbeddingModelName(model) : model
  const catalog = await fetchOllamaEmbeddingModelCatalog(signal)
  /** Ollama resolves a bare name to its `:latest` tag, so both spellings match. */
  const metadata = catalog.find(
    (candidate) => candidate.id === name || candidate.id === `${name}:latest`
  )
  if (!metadata) throw new OllamaEmbeddingModelNotFoundError(name)
  if (metadata.dimensions === undefined) throw new OllamaEmbeddingWidthUnknownError(name)
  return { id: metadata.id, dimensions: metadata.dimensions }
}
