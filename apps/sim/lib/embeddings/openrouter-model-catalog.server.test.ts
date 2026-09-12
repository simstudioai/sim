/**
 * @vitest-environment node
 */
import { inputValidationMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOpenRouterEmbeddingModelCatalog,
  getOpenRouterEmbeddingModelMetadata,
  OpenRouterEmbeddingModelNotFoundError,
} from '@/lib/embeddings/openrouter-model-catalog.server'

vi.mock('@/lib/core/security/input-validation.server', () => ({
  ...inputValidationMock,
  secureFetchWithValidation: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

const fetchMock = vi.fn()
let clock = 0

describe('OpenRouter embedding model catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clock += 300_001
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('resolves a prefixed model with its live input ceiling', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [{ id: 'qwen/qwen3-embedding-8b', context_length: 32768 }],
      })
    )

    await expect(
      getOpenRouterEmbeddingModelMetadata('openrouter/qwen/qwen3-embedding-8b')
    ).resolves.toEqual({
      id: 'openrouter/qwen/qwen3-embedding-8b',
      maxInputTokens: 32768,
    })
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

  it('reuses the public catalog for five minutes without sharing mutable results', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ data: [{ id: 'qwen/embed', context_length: 32768 }] })
    )
    const first = await fetchOpenRouterEmbeddingModelCatalog()
    first[0].maxInputTokens = 1
    first.length = 0

    clock += 299_999
    await expect(fetchOpenRouterEmbeddingModelCatalog()).resolves.toEqual([
      { id: 'openrouter/qwen/embed', maxInputTokens: 32768 },
    ])
    expect(fetchMock).toHaveBeenCalledOnce()

    clock += 2
    await fetchOpenRouterEmbeddingModelCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a rejected catalog without caching the failure', async () => {
    const cancelBody = vi.fn()
    fetchMock
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel: cancelBody }), { status: 503 })
      )
      .mockResolvedValueOnce(Response.json({ data: [] }))

    await expect(fetchOpenRouterEmbeddingModelCatalog()).rejects.toThrow('503')
    expect(cancelBody).toHaveBeenCalledOnce()
    await expect(fetchOpenRouterEmbeddingModelCatalog()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('forwards cancellation on a miss and rejects an aborted caller on a cache hit', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [] }))
    const controller = new AbortController()
    await fetchOpenRouterEmbeddingModelCatalog(controller.signal)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/embeddings/models',
      expect.objectContaining({ profile: 'configuredEndpoint', signal: controller.signal })
    )

    controller.abort()
    await expect(fetchOpenRouterEmbeddingModelCatalog(controller.signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
