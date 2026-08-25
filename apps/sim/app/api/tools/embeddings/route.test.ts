/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockEmbeddingOutputLimitError,
  mockEmbed,
  mockEmbedOpenRouter,
  mockGetOpenRouterEmbeddingModelMetadata,
} = vi.hoisted(() => {
  class MockEmbeddingOutputLimitError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'EmbeddingOutputLimitError'
    }
  }

  return {
    MockEmbeddingOutputLimitError,
    mockEmbed: vi.fn(),
    mockEmbedOpenRouter: vi.fn(),
    mockGetOpenRouterEmbeddingModelMetadata: vi.fn(),
  }
})

vi.mock('@/lib/embeddings/openrouter-model-catalog.server', () => ({
  getOpenRouterEmbeddingModelMetadata: mockGetOpenRouterEmbeddingModelMetadata,
  OpenRouterEmbeddingModelNotFoundError: class OpenRouterEmbeddingModelNotFoundError extends Error {
    constructor(model: string) {
      super(`Unsupported OpenRouter embedding model: ${model}`)
      this.name = 'OpenRouterEmbeddingModelNotFoundError'
    }
  },
}))

vi.mock('@/lib/embeddings', async () => {
  const catalog = await import('@/lib/embeddings/catalog')
  return {
    embed: mockEmbed,
    embedOpenRouter: mockEmbedOpenRouter,
    EmbeddingOutputLimitError: MockEmbeddingOutputLimitError,
    DEFAULT_OPENROUTER_EMBEDDING_MODEL: 'openrouter/openai/text-embedding-3-small',
    findEmbeddingModelInfo: catalog.findEmbeddingModelInfo,
    getModelsForProvider: catalog.getModelsForProvider,
    resolveDimensions: catalog.resolveDimensions,
  }
})

import { OpenRouterEmbeddingModelNotFoundError } from '@/lib/embeddings/openrouter-model-catalog.server'
import { POST } from '@/app/api/tools/embeddings/route'

const baseBody = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  input: 'hello world',
  apiKey: 'sk-test',
}

function post(body: Record<string, unknown>) {
  return POST(createMockRequest('POST', body) as never, undefined as never)
}

describe('POST /api/tools/embeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpenRouterEmbeddingModelMetadata.mockResolvedValue({
      id: 'openrouter/qwen/qwen3-embedding-8b',
      maxInputTokens: 32768,
    })
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockEmbed.mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      totalTokens: 3,
      isBYOK: true,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
      dimensions: 1536,
    })
    mockEmbedOpenRouter.mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      totalTokens: 3,
      billableTokens: 0,
      isBYOK: true,
      modelName: 'openrouter/qwen/qwen3-embedding-8b',
      pricingId: 'openrouter/qwen/qwen3-embedding-8b',
      dimensions: 2,
    })
  })

  it('rejects an unauthenticated caller', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({ success: false })
    const response = await post(baseBody)
    expect(response.status).toBe(401)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('embeds and returns the contract shape', async () => {
    const response = await post(baseBody)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toMatchObject({
      success: true,
      embeddings: [[0.1, 0.2]],
      model: 'text-embedding-3-small',
      provider: 'openai',
      dimensions: 1536,
      usage: { prompt_tokens: 3, total_tokens: 3 },
      __embeddingTokens: 3,
    })
  })

  it('rejects an unknown model', async () => {
    const response = await post({ ...baseBody, model: 'not-a-real-model' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Unsupported embedding model')
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('rejects a model that belongs to another provider', async () => {
    const response = await post({ ...baseBody, provider: 'cohere', model: 'gemini-embedding-001' })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('belongs to gemini, not cohere')
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  /**
   * Regression: an unsupported `dimensions` used to escape as the generic 502
   * from the embed() catch, reporting a client input error as an upstream
   * failure.
   */
  it('rejects an unsupported dimension with 400, not 502', async () => {
    const response = await post({ ...baseBody, dimensions: 777 })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('does not support 777-dimensional output')
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('rejects any dimension for a model without Matryoshka support', async () => {
    const response = await post({
      ...baseBody,
      provider: 'mistral',
      model: 'mistral-embed',
      dimensions: 999,
    })
    expect(response.status).toBe(400)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('accepts a supported dimension', async () => {
    const response = await post({ ...baseBody, dimensions: 512 })
    expect(response.status).toBe(200)
    expect(mockEmbed).toHaveBeenCalledWith(
      ['hello world'],
      expect.objectContaining({ dimensions: 512 })
    )
  })

  it('routes OpenRouter through its transport with an explicit key', async () => {
    const response = await post({
      provider: 'openrouter',
      model: 'openrouter/qwen/qwen3-embedding-8b',
      input: 'hello world',
      apiKey: 'or-test',
    })

    expect(response.status).toBe(200)
    expect(mockEmbedOpenRouter).toHaveBeenCalledWith(
      ['hello world'],
      expect.objectContaining({
        apiKey: 'or-test',
        maxInputTokens: 32768,
        model: 'openrouter/qwen/qwen3-embedding-8b',
      })
    )
    expect(mockEmbed).not.toHaveBeenCalled()
    expect((await response.json()).provider).toBe('openrouter')
  })

  it('rejects OpenRouter without an explicit key', async () => {
    const response = await post({
      provider: 'openrouter',
      model: 'openrouter/openai/text-embedding-3-small',
      input: 'hello world',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('apiKey')
    expect(mockEmbed).not.toHaveBeenCalled()
    expect(mockEmbedOpenRouter).not.toHaveBeenCalled()
  })

  it('rejects an invalid OpenRouter model id', async () => {
    const response = await post({
      provider: 'openrouter',
      model: 'openrouter/not-qualified',
      input: 'hello world',
      apiKey: 'or-test',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Invalid OpenRouter embedding model')
    expect(mockEmbedOpenRouter).not.toHaveBeenCalled()
  })

  it('rejects a qualified model that is absent from OpenRouter', async () => {
    mockGetOpenRouterEmbeddingModelMetadata.mockRejectedValue(
      new OpenRouterEmbeddingModelNotFoundError('openrouter/example/missing')
    )

    const response = await post({
      provider: 'openrouter',
      model: 'openrouter/example/missing',
      input: 'hello world',
      apiKey: 'or-test',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Unsupported OpenRouter embedding model')
    expect(mockEmbedOpenRouter).not.toHaveBeenCalled()
  })

  it('keeps API keys required for non-OpenRouter providers', async () => {
    const response = await post({
      provider: 'openai',
      model: 'text-embedding-3-small',
      input: 'hello world',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('apiKey')
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('surfaces a provider failure as 502', async () => {
    mockEmbed.mockRejectedValue(new Error('Embedding API failed: 429 Too Many Requests'))
    const response = await post(baseBody)
    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('429')
  })

  it('returns 413 when the requested embedding output exceeds the safe aggregate limit', async () => {
    mockEmbed.mockRejectedValue(
      new MockEmbeddingOutputLimitError('Embedding output exceeds the safe aggregate limit')
    )
    const response = await post(baseBody)
    expect(response.status).toBe(413)
    expect((await response.json()).error).toContain('safe aggregate limit')
  })

  it('splits a JSON-array input into separate texts', async () => {
    await post({ ...baseBody, input: '["alpha","beta"]' })
    expect(mockEmbed).toHaveBeenCalledWith(['alpha', 'beta'], expect.anything())
  })

  /**
   * The contract bounds the array arm, but a JSON-encoded array reaches the
   * route as a plain string and is only expanded after validation — so the
   * bounds have to be re-applied to the normalized list or they hold for a
   * native array body only.
   */
  describe('JSON-encoded array bounds', () => {
    it('rejects a JSON array that exceeds the input count limit', async () => {
      const many = JSON.stringify(Array.from({ length: 1001 }, (_, i) => `t${i}`))
      const response = await post({ ...baseBody, input: many })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('cannot exceed 1000 texts')
      expect(mockEmbed).not.toHaveBeenCalled()
    })

    it('rejects an empty JSON array instead of reporting success with no vectors', async () => {
      const response = await post({ ...baseBody, input: '[]' })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('at least one text')
      expect(mockEmbed).not.toHaveBeenCalled()
    })

    it('rejects a JSON array containing a blank entry', async () => {
      const response = await post({ ...baseBody, input: '["ok","   "]' })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('entries cannot be empty')
      expect(mockEmbed).not.toHaveBeenCalled()
    })

    it('accepts a JSON array within the bounds', async () => {
      const response = await post({ ...baseBody, input: '["alpha","beta"]' })

      expect(response.status).toBe(200)
      expect(mockEmbed).toHaveBeenCalledWith(['alpha', 'beta'], expect.anything())
    })
  })

  it('embeds a non-JSON string as a single text', async () => {
    await post({ ...baseBody, input: 'just a sentence' })
    expect(mockEmbed).toHaveBeenCalledWith(['just a sentence'], expect.anything())
  })
})
