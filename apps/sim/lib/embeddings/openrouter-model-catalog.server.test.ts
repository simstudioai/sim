import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getOpenRouterEmbeddingModelMetadata,
  OpenRouterEmbeddingModelNotFoundError,
} from '@/lib/embeddings/openrouter-model-catalog.server'

const fetchMock = vi.fn()

describe('OpenRouter embedding model catalog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a model absent from the live embedding catalog', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [] }))

    await expect(
      getOpenRouterEmbeddingModelMetadata('openrouter/example/missing')
    ).rejects.toBeInstanceOf(OpenRouterEmbeddingModelNotFoundError)
  })

  it('fails fast when OpenRouter omits a model context length', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ id: 'example/missing-context' }] }))

    await expect(
      getOpenRouterEmbeddingModelMetadata('openrouter/example/missing-context')
    ).rejects.toThrow('Invalid input')
  })
})
