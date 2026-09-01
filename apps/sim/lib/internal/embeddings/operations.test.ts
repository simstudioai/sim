/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  embedOpenRouter: vi.fn(),
}))

vi.mock('@/lib/embeddings', () => ({
  DEFAULT_MODEL_BY_PROVIDER: { openai: 'text-embedding-3-small' },
  DEFAULT_OPENROUTER_EMBEDDING_MODEL: 'openrouter/openai/text-embedding-3-small',
  EmbeddingOutputLimitError: class EmbeddingOutputLimitError extends Error {},
  embed: mocks.embed,
  embedOpenRouter: mocks.embedOpenRouter,
  findEmbeddingModelInfo: vi.fn(),
  resolveDimensions: vi.fn(),
}))

vi.mock('@/lib/embeddings/openrouter-model-catalog.server', () => ({
  getOpenRouterEmbeddingModelMetadata: vi.fn(),
  OpenRouterEmbeddingModelNotFoundError: class OpenRouterEmbeddingModelNotFoundError extends Error {},
}))

import { executeEmbedding } from '@/lib/internal/embeddings/operations'
import { MAX_EMBEDDING_INPUTS, MAX_EMBEDDING_TOTAL_CHARS } from '@/lib/internal/embeddings/schema'

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
    expect(mocks.embed).not.toHaveBeenCalled()
  })

  it('rejects aggregate input characters before provider dispatch', async () => {
    const response = await executeEmbedding(
      { ...baseInput, input: 'x'.repeat(MAX_EMBEDDING_TOTAL_CHARS + 1) },
      {}
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain(`${MAX_EMBEDDING_TOTAL_CHARS}`)
    expect(mocks.embed).not.toHaveBeenCalled()
  })
})
