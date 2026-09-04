/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockOllamaMetadata } = vi.hoisted(() => ({
  mockEnv: {} as { KB_EMBEDDING_MODEL?: string; EMBEDDING_OUTPUT_DIMS?: string },
  mockOllamaMetadata: vi.fn(),
}))

/**
 * `envNumber` is the real implementation, not a stub: the whole point of the
 * cases below is that `createEnv` runs with `skipValidation`, so every value
 * arrives as the raw string from the environment however its schema is declared.
 */
vi.mock('@/lib/core/config/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env')>()),
  env: mockEnv,
}))

vi.mock('@/lib/embeddings/ollama-model-catalog.server', () => ({
  getOllamaEmbeddingModelMetadata: mockOllamaMetadata,
}))

import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'

describe('getConfiguredKbEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.KB_EMBEDDING_MODEL = undefined
    mockEnv.EMBEDDING_OUTPUT_DIMS = undefined
    mockOllamaMetadata.mockRejectedValue(new Error('no server configured'))
  })

  it('defaults to the model and width knowledge bases were always created at', async () => {
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
  })

  it('stores at the configured width when the model can emit it', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'text-embedding-3-large'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '3072'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-large',
      dimensions: 3072,
    })
  })

  it('accepts any storable width from a model on the deployment’s own Ollama', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'ollama/nomic-embed-text'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '768'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'ollama/nomic-embed-text',
      dimensions: 768,
    })
  })

  /**
   * Sim can read a local model's width off the server it is installed on, so an
   * unstated width is resolved rather than defaulted — defaulting would create
   * every base at 1,536 and fail each document against a 768-wide model.
   */
  it('reads an unstated Ollama width from the server the model is installed on', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'ollama/nomic-embed-text'
    mockOllamaMetadata.mockResolvedValue({ id: 'nomic-embed-text:latest', dimensions: 768 })

    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'ollama/nomic-embed-text',
      dimensions: 768,
    })
    expect(mockOllamaMetadata).toHaveBeenCalledWith('ollama/nomic-embed-text')
  })

  it('prefers a stated width over the server, and never asks when one is stated', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'ollama/nomic-embed-text'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '1024'
    mockOllamaMetadata.mockResolvedValue({ id: 'nomic-embed-text:latest', dimensions: 768 })

    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'ollama/nomic-embed-text',
      dimensions: 1024,
    })
    expect(mockOllamaMetadata).not.toHaveBeenCalled()
  })

  it('falls back to the platform default when the server cannot be asked', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'ollama/nomic-embed-text'
    mockOllamaMetadata.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'ollama/nomic-embed-text',
      dimensions: 1536,
    })
  })

  it('falls back when the server reports a width no column can store', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'ollama/odd-width'
    mockOllamaMetadata.mockResolvedValue({ id: 'odd-width:latest', dimensions: 1152 })

    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'ollama/odd-width',
      dimensions: 1536,
    })
  })

  it('falls back when the width is not a number at all', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'text-embedding-3-large'
    mockEnv.EMBEDDING_OUTPUT_DIMS = 'wide'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-large',
      dimensions: 1536,
    })
  })

  it('falls back when the width has no storage column, keeping the chosen model', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'text-embedding-3-large'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '1000'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-large',
      dimensions: 1536,
    })
  })

  it('falls back when the model cannot emit the configured width', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'gemini-embedding-001'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '1024'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'gemini-embedding-001',
      dimensions: 1536,
    })
  })

  it('falls back to the default model when the configured one cannot index a knowledge base', async () => {
    mockEnv.KB_EMBEDDING_MODEL = 'text-embedding-ada-002'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '768'
    await expect(getConfiguredKbEmbedding()).resolves.toEqual({
      model: 'text-embedding-3-small',
      dimensions: 768,
    })
  })
})
