/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as { KB_EMBEDDING_MODEL?: string; EMBEDDING_OUTPUT_DIMS?: string },
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

import { getConfiguredKbEmbedding } from '@/lib/knowledge/embeddings'

describe('getConfiguredKbEmbedding', () => {
  beforeEach(() => {
    mockEnv.KB_EMBEDDING_MODEL = undefined
    mockEnv.EMBEDDING_OUTPUT_DIMS = undefined
  })

  it('defaults to the model and width knowledge bases were always created at', () => {
    expect(getConfiguredKbEmbedding()).toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
  })

  it('stores at the configured width when the model can emit it', () => {
    mockEnv.KB_EMBEDDING_MODEL = 'text-embedding-3-large'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '3072'
    expect(getConfiguredKbEmbedding()).toEqual({
      model: 'text-embedding-3-large',
      dimensions: 3072,
    })
  })

  it('accepts any storable width from a model on the deployment’s own Ollama', () => {
    mockEnv.KB_EMBEDDING_MODEL = 'ollama/nomic-embed-text'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '768'
    expect(getConfiguredKbEmbedding()).toEqual({
      model: 'ollama/nomic-embed-text',
      dimensions: 768,
    })
  })

  it('falls back when the width is not a number at all', () => {
    mockEnv.KB_EMBEDDING_MODEL = 'text-embedding-3-large'
    mockEnv.EMBEDDING_OUTPUT_DIMS = 'wide'
    expect(getConfiguredKbEmbedding()).toEqual({
      model: 'text-embedding-3-large',
      dimensions: 1536,
    })
  })

  it('falls back when the width has no storage column, keeping the chosen model', () => {
    mockEnv.KB_EMBEDDING_MODEL = 'text-embedding-3-large'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '1000'
    expect(getConfiguredKbEmbedding()).toEqual({
      model: 'text-embedding-3-large',
      dimensions: 1536,
    })
  })

  it('falls back when the model cannot emit the configured width', () => {
    mockEnv.KB_EMBEDDING_MODEL = 'gemini-embedding-001'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '1024'
    expect(getConfiguredKbEmbedding()).toEqual({
      model: 'gemini-embedding-001',
      dimensions: 1536,
    })
  })

  it('falls back to the default model when the configured one cannot index a knowledge base', () => {
    mockEnv.KB_EMBEDDING_MODEL = 'text-embedding-ada-002'
    mockEnv.EMBEDDING_OUTPUT_DIMS = '768'
    expect(getConfiguredKbEmbedding()).toEqual({
      model: 'text-embedding-3-small',
      dimensions: 768,
    })
  })
})
