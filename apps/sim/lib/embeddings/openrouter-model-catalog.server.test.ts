/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getOpenRouterEmbeddingModelMetadata,
  OpenRouterEmbeddingModelNotFoundError,
} from '@/lib/embeddings/openrouter-model-catalog.server'

const fetchMock = vi.fn()

describe('OpenRouter embedding model catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('resolves a prefixed model with its live input ceiling', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'qwen/qwen3-embedding-8b', context_length: 32768 }],
      }),
    })

    await expect(
      getOpenRouterEmbeddingModelMetadata('openrouter/qwen/qwen3-embedding-8b')
    ).resolves.toEqual({
      id: 'openrouter/qwen/qwen3-embedding-8b',
      maxInputTokens: 32768,
    })
  })

  it('rejects a model absent from the live embedding catalog', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    await expect(
      getOpenRouterEmbeddingModelMetadata('openrouter/example/missing')
    ).rejects.toBeInstanceOf(OpenRouterEmbeddingModelNotFoundError)
  })

  it('fails fast when OpenRouter omits a model context length', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'example/missing-context' }] }),
    })

    await expect(
      getOpenRouterEmbeddingModelMetadata('openrouter/example/missing-context')
    ).rejects.toThrow('Invalid input')
  })
})
