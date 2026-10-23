import { mockEnvObject } from '@sim/testing/mocks/env.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockOllamaMetadata } = vi.hoisted(() => ({ mockOllamaMetadata: vi.fn() }))

vi.mock('@/lib/embeddings/ollama-model-catalog.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/embeddings/ollama-model-catalog.server')>()),
  getOllamaEmbeddingModelMetadata: mockOllamaMetadata,
}))

import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'

describe('getConfiguredKbEmbedding', () => {
  beforeEach(() => {
    mockEnvObject.KB_EMBEDDING_MODEL = undefined
    mockEnvObject.EMBEDDING_OUTPUT_DIMS = undefined
    mockOllamaMetadata.mockRejectedValue(new Error('no server configured'))
  })

  it('accepts any storable width from a model on the deployment’s own Ollama', async () => {
    mockEnvObject.KB_EMBEDDING_MODEL = 'ollama/nomic-embed-text'
    mockEnvObject.EMBEDDING_OUTPUT_DIMS = '768'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'ollama/nomic-embed-text',
      dimensions: 768,
    })
  })

  it('prefers a stated width over the server, and never asks when one is stated', async () => {
    mockEnvObject.KB_EMBEDDING_MODEL = 'ollama/nomic-embed-text'
    mockEnvObject.EMBEDDING_OUTPUT_DIMS = '1024'
    mockOllamaMetadata.mockResolvedValue({ id: 'nomic-embed-text:latest', dimensions: 768 })

    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'ollama/nomic-embed-text',
      dimensions: 1024,
    })
    expect(mockOllamaMetadata).not.toHaveBeenCalled()
  })

  /**
   * There is no width to fall back to: the adapter cannot ask Ollama for a
   * different one, so the platform default would pin the base at a width the
   * model does not emit and fail every document. Refusing is recoverable;
   * a base created at an impossible width is not.
   */
  it('refuses to create a base when the server cannot be asked', async () => {
    mockEnvObject.KB_EMBEDDING_MODEL = 'ollama/nomic-embed-text'
    mockOllamaMetadata.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getConfiguredKbEmbedding()).rejects.toThrow('Set EMBEDDING_OUTPUT_DIMS')
  })

  it('refuses to create a base when the model emits a width no column can store', async () => {
    mockEnvObject.KB_EMBEDDING_MODEL = 'ollama/odd-width'
    mockOllamaMetadata.mockResolvedValue({ id: 'odd-width:latest', dimensions: 1152 })

    await expect(getConfiguredKbEmbedding()).rejects.toThrow(
      'emits 1152-dimensional vectors, which knowledge bases cannot store'
    )
  })

  it('falls back when the width has no storage column, keeping the chosen model', async () => {
    mockEnvObject.KB_EMBEDDING_MODEL = 'text-embedding-3-large'
    mockEnvObject.EMBEDDING_OUTPUT_DIMS = '1000'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-large',
      dimensions: 1536,
    })
  })

  it('falls back to the default model when the configured one cannot index a knowledge base', async () => {
    mockEnvObject.KB_EMBEDDING_MODEL = 'text-embedding-ada-002'
    mockEnvObject.EMBEDDING_OUTPUT_DIMS = '768'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-small',
      dimensions: 768,
    })
  })
})
