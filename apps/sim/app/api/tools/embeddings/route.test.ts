/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEmbed } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
}))

vi.mock('@/lib/embeddings', async () => {
  const catalog = await import('@/lib/embeddings/catalog')
  return {
    embed: mockEmbed,
    findEmbeddingModelInfo: catalog.findEmbeddingModelInfo,
    getModelsForProvider: catalog.getModelsForProvider,
    resolveDimensions: catalog.resolveDimensions,
  }
})

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

  it('surfaces a provider failure as 502', async () => {
    mockEmbed.mockRejectedValue(new Error('Embedding API failed: 429 Too Many Requests'))
    const response = await post(baseBody)
    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('429')
  })

  it('splits a JSON-array input into separate texts', async () => {
    await post({ ...baseBody, input: '["alpha","beta"]' })
    expect(mockEmbed).toHaveBeenCalledWith(['alpha', 'beta'], expect.anything())
  })

  it('embeds a non-JSON string as a single text', async () => {
    await post({ ...baseBody, input: 'just a sentence' })
    expect(mockEmbed).toHaveBeenCalledWith(['just a sentence'], expect.anything())
  })
})
