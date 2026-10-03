import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecuteEmbedding = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/embeddings/operations', () => ({
  executeEmbedding: mockExecuteEmbedding,
}))

import { executeEmbeddingsTool } from '@/lib/internal/embeddings/execute-tool'

function request(input: unknown, overrides: Record<string, unknown> = {}) {
  return {
    toolId: 'embeddings_openai',
    input,
    headers: new Headers(),
    context: { userId: 'user-1' },
    requestId: 'request-1',
    ...overrides,
  } as never
}

describe('executeEmbeddingsTool', () => {
  beforeEach(() => {
    mockExecuteEmbedding.mockResolvedValue(Response.json({ success: true }))
  })

  it('rejects a provider that does not match the declared tool', async () => {
    const response = await executeEmbeddingsTool(
      request({ provider: 'gemini', apiKey: 'key', input: 'hello' })
    )

    expect(response.status).toBe(400)
    expect(mockExecuteEmbedding).not.toHaveBeenCalled()
  })
})
