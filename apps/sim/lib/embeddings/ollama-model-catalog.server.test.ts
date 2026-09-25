import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOllamaEmbeddingModelCatalog,
  getOllamaEmbeddingModelMetadata,
  OllamaEmbeddingModelNotFoundError,
  OllamaEmbeddingWidthUnknownError,
  OllamaUnreachableError,
} from '@/lib/embeddings/ollama-model-catalog.server'

const fetchMock = vi.fn()

/** Mirrors an Ollama server: `/api/tags` lists everything, `/api/show` classifies it. */
function serve(
  models: Record<string, { capabilities?: string[]; modelInfo?: Record<string, unknown> }>
) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/api/tags')) {
      return Promise.resolve(
        Response.json({ models: Object.keys(models).map((name) => ({ name })) })
      )
    }
    const { model } = JSON.parse(String(init?.body)) as { model: string }
    /** Ollama resolves a bare name to its `:latest` tag server-side. */
    const detail = models[model] ?? models[`${model}:latest`]
    if (!detail) return Promise.resolve(new Response('not found', { status: 404 }))
    return Promise.resolve(
      Response.json({
        ...(detail.capabilities ? { capabilities: detail.capabilities } : {}),
        ...(detail.modelInfo ? { model_info: detail.modelInfo } : {}),
      })
    )
  })
}

describe('Ollama embedding model catalog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    setEnv({ OLLAMA_URL: 'http://ollama.internal:11434' })
  })

  afterEach(() => {
    resetEnvMock()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  /** `/api/tags` lists chat and embedding models together and distinguishes neither. */
  it('drops a chat model, which the tags listing does not separate out', async () => {
    serve({
      'smollm2:135m': {
        capabilities: ['completion'],
        modelInfo: { 'llama.embedding_length': 576 },
      },
      'all-minilm:latest': {
        capabilities: ['embedding'],
        modelInfo: { 'bert.embedding_length': 384 },
      },
    })

    await expect(fetchOllamaEmbeddingModelCatalog()).resolves.toEqual([
      { id: 'all-minilm:latest', dimensions: 384 },
    ])
  })

  it('keeps the rest of the catalog when one model cannot be inspected', async () => {
    serve({
      'all-minilm:latest': {
        capabilities: ['embedding'],
        modelInfo: { 'bert.embedding_length': 384 },
      },
    })
    const served = fetchMock.getMockImplementation()
    /** `broken` has to fail its own `/api/show`, or the skip path never runs. */
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/tags')) {
        return Promise.resolve(
          Response.json({ models: [{ name: 'broken' }, { name: 'all-minilm:latest' }] })
        )
      }
      const { model } = JSON.parse(String(init?.body)) as { model: string }
      if (model === 'broken') return Promise.reject(new Error('inspection failed'))
      return served?.(url, init)
    })

    await expect(fetchOllamaEmbeddingModelCatalog()).resolves.toEqual([
      { id: 'all-minilm:latest', dimensions: 384 },
    ])
  })

  it('offers nothing rather than throwing when no Ollama answers', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(fetchOllamaEmbeddingModelCatalog()).resolves.toEqual([])
  })

  it('rejects a model that is not installed', async () => {
    serve({})

    await expect(getOllamaEmbeddingModelMetadata('missing')).rejects.toBeInstanceOf(
      OllamaEmbeddingModelNotFoundError
    )
  })

  it('reports a server that stops answering as an outage, not a missing model', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getOllamaEmbeddingModelMetadata('all-minilm')).rejects.toBeInstanceOf(
      OllamaUnreachableError
    )
  })

  /**
   * The width is what the client validates the response against, so a model
   * whose width cannot be read is refused rather than embedded unchecked.
   */
  it('refuses a model whose width Ollama does not report', async () => {
    serve({ 'widthless:latest': { capabilities: ['embedding'] } })

    await expect(getOllamaEmbeddingModelMetadata('widthless')).rejects.toBeInstanceOf(
      OllamaEmbeddingWidthUnknownError
    )
  })
})
