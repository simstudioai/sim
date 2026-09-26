import { embeddingsMock, embeddingsMockFns } from '@sim/testing/mocks/embeddings.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/embeddings', () => embeddingsMock)

vi.mock('@/lib/embeddings/openrouter-model-catalog.server', () => ({
  getOpenRouterEmbeddingModelMetadata: vi.fn(),
  OpenRouterEmbeddingModelNotFoundError: class OpenRouterEmbeddingModelNotFoundError extends Error {},
}))

import { executeEmbedding } from '@/lib/internal/embeddings/operations'
import { MAX_EMBEDDING_INPUTS, MAX_EMBEDDING_TOTAL_CHARS } from '@/lib/internal/embeddings/schema'

const mockEmbed = embeddingsMockFns.mockEmbed

const baseInput = {
  provider: 'openai' as const,
  apiKey: 'key',
  model: 'text-embedding-3-small',
}

describe('embedding operation admission limits', () => {
  it('rejects a JSON-encoded array after expansion when it exceeds the item cap', async () => {
    const input = JSON.stringify(Array.from({ length: MAX_EMBEDDING_INPUTS + 1 }, () => 'x'))
    const response = await executeEmbedding({ ...baseInput, input }, {})

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain(`${MAX_EMBEDDING_INPUTS}`)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('rejects aggregate input characters before provider dispatch', async () => {
    const response = await executeEmbedding(
      { ...baseInput, input: 'x'.repeat(MAX_EMBEDDING_TOTAL_CHARS + 1) },
      {}
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain(`${MAX_EMBEDDING_TOTAL_CHARS}`)
    expect(mockEmbed).not.toHaveBeenCalled()
  })
})
