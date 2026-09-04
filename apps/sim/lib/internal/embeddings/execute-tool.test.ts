/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecuteEmbedding = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/embeddings/operations', () => ({
  executeEmbedding: mockExecuteEmbedding,
}))

import {
  EMBEDDINGS_TOOL_PROVIDERS,
  executeEmbeddingsTool,
} from '@/lib/internal/embeddings/execute-tool'
import { getRegisteredInternalToolOperationIds } from '@/lib/internal/tool-operations/registry.server'

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
    vi.clearAllMocks()
    mockExecuteEmbedding.mockResolvedValue(Response.json({ success: true }))
  })

  it('rejects a provider that does not match the declared tool', async () => {
    const response = await executeEmbeddingsTool(
      request({ provider: 'gemini', apiKey: 'key', input: 'hello' })
    )

    expect(response.status).toBe(400)
    expect(mockExecuteEmbedding).not.toHaveBeenCalled()
  })

  it('supports the legacy OpenAI alias through the same operation', async () => {
    const response = await executeEmbeddingsTool(
      request(
        { provider: 'openai', apiKey: 'key', input: '<block.output>' },
        { toolId: 'openai_embeddings' }
      )
    )

    expect(response.status).toBe(200)
    expect(mockExecuteEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', input: '<block.output>' }),
      expect.objectContaining({ signal: undefined })
    )
  })

  it.each([null, '', '   '])(
    'treats dimensions sentinel %j as the native default',
    async (value) => {
      const response = await executeEmbeddingsTool(
        request({ provider: 'openai', apiKey: 'key', input: 'hello', dimensions: value })
      )

      expect(response.status).toBe(200)
      expect(mockExecuteEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({ dimensions: undefined }),
        expect.any(Object)
      )
    }
  )

  it('still rejects explicit zero dimensions', async () => {
    const response = await executeEmbeddingsTool(
      request({ provider: 'openai', apiKey: 'key', input: 'hello', dimensions: 0 })
    )

    expect(response.status).toBe(400)
    expect(mockExecuteEmbedding).not.toHaveBeenCalled()
  })

  /**
   * Registering a tool id with the operation registry is only half the wiring:
   * without an entry here the handler rejects its own tool as unsupported, and
   * nothing but a call would say so.
   */
  it('maps every embeddings tool the operation registry routes to this handler', () => {
    const registered = getRegisteredInternalToolOperationIds().filter((id) =>
      Object.hasOwn(EMBEDDINGS_TOOL_PROVIDERS, id)
    )
    const routedHere = getRegisteredInternalToolOperationIds().filter(
      (id) => id.startsWith('embeddings_') || id === 'openai_embeddings'
    )

    expect(registered.sort()).toEqual(routedHere.sort())
  })

  it('runs Ollama without a credential the schema does not declare', async () => {
    const response = await executeEmbeddingsTool(
      request(
        { provider: 'ollama', model: 'nomic-embed-text', input: 'hello' },
        { toolId: 'embeddings_ollama' }
      )
    )

    expect(response.status).toBe(200)
    expect(mockExecuteEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ollama', model: 'nomic-embed-text' }),
      expect.any(Object)
    )
  })
})
