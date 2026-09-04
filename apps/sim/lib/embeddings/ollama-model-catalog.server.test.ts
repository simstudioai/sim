/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOllamaEmbeddingModelCatalog,
  getOllamaEmbeddingModelMetadata,
  OllamaEmbeddingModelNotFoundError,
  OllamaEmbeddingWidthUnknownError,
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
    const detail = models[model]
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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    setEnv({ OLLAMA_URL: 'http://ollama.internal:11434' })
  })

  afterEach(() => {
    resetEnvMock()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('keeps embedding models with the width their architecture publishes', async () => {
    serve({
      'nomic-embed-text:latest': {
        capabilities: ['embedding'],
        modelInfo: { 'nomic-bert.embedding_length': 768, 'nomic-bert.block_count': 12 },
      },
    })

    await expect(fetchOllamaEmbeddingModelCatalog()).resolves.toEqual([
      { id: 'nomic-embed-text:latest', dimensions: 768 },
    ])
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

  it('keeps a model from a server too old to report capabilities', async () => {
    serve({ 'legacy-embed': { modelInfo: { 'bert.embedding_length': 512 } } })

    await expect(fetchOllamaEmbeddingModelCatalog()).resolves.toEqual([
      { id: 'legacy-embed', dimensions: 512 },
    ])
  })

  it('keeps the rest of the catalog when one model cannot be inspected', async () => {
    serve({
      broken: { capabilities: ['embedding'] },
      'all-minilm:latest': {
        capabilities: ['embedding'],
        modelInfo: { 'bert.embedding_length': 384 },
      },
    })
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        Response.json({ models: [{ name: 'broken' }, { name: 'all-minilm:latest' }] })
      )
    )

    const catalog = await fetchOllamaEmbeddingModelCatalog()
    expect(catalog).toContainEqual({ id: 'all-minilm:latest', dimensions: 384 })
  })

  it('offers nothing rather than throwing when no Ollama answers', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(fetchOllamaEmbeddingModelCatalog()).resolves.toEqual([])
  })

  it('resolves a bare name against the tag Ollama installed it under', async () => {
    serve({
      'all-minilm:latest': {
        capabilities: ['embedding'],
        modelInfo: { 'bert.embedding_length': 384 },
      },
    })

    await expect(getOllamaEmbeddingModelMetadata('all-minilm')).resolves.toEqual({
      id: 'all-minilm:latest',
      dimensions: 384,
    })
    await expect(getOllamaEmbeddingModelMetadata('ollama/all-minilm')).resolves.toEqual({
      id: 'all-minilm:latest',
      dimensions: 384,
    })
  })

  it('rejects a model that is not installed', async () => {
    serve({})

    await expect(getOllamaEmbeddingModelMetadata('missing')).rejects.toBeInstanceOf(
      OllamaEmbeddingModelNotFoundError
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
