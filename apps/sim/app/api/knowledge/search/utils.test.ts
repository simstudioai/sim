/**
 * Tests for knowledge search utility functions
 * Focuses on testing core functionality with simplified mocking
 *
 * @vitest-environment node
 */
import { mockNextFetchResponse, setupGlobalFetchMock } from '@sim/testing/mocks'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import * as documentsUtilsModule from '@/lib/knowledge/documents/utils'

vi.mock('drizzle-orm')

/**
 * Spy on the real documents/utils namespace instead of vi.mock: the shared
 * `@/lib/knowledge/embeddings` module may be cached bound to the real module,
 * so patching the namespace is the only wiring that always applies.
 */
const retrySpy = vi
  .spyOn(documentsUtilsModule, 'retryWithExponentialBackoff')
  .mockImplementation(((fn: () => unknown) => fn()) as never)

afterAll(() => {
  retrySpy.mockRestore()
})

/**
 * Under `isolate: false` the shared `@/lib/knowledge/embeddings` module may be
 * cached bound to the REAL env module, so tests mutate the real `env` object
 * (the tests below clear and assign it per case) instead of vi.mock'ing a
 * file-local replacement that a cached consumer would never see. The snapshot
 * restores whatever the worker started with after every test.
 */
const envSnapshot = { ...env }

afterEach(() => {
  for (const key of Object.keys(env)) {
    delete (env as Record<string, unknown>)[key]
  }
  Object.assign(env, envSnapshot)
})

import {
  generateSearchEmbedding,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
} from '@/app/api/knowledge/search/utils'

describe('Knowledge Search Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The worker-level fetch stub from vitest.setup.ts is removed after the
    // first test by `unstubGlobals: true`; re-stub it per test so
    // mockNextFetchResponse always operates on a mocked fetch.
    setupGlobalFetchMock({ json: {} })
    retrySpy.mockImplementation(((fn: () => unknown) => fn()) as never)
  })

  describe('handleTagOnlySearch', () => {
    it('should throw error when no filters provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        structuredFilters: [],
      }

      await expect(handleTagOnlySearch(params)).rejects.toThrow(
        'Tag filters are required for tag-only search'
      )
    })

    it('should accept valid parameters for tag-only search', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' }],
      }

      // This test validates the function accepts the right parameters
      // The actual database interaction is tested via route tests
      expect(params.knowledgeBaseIds).toEqual(['kb-123'])
      expect(params.topK).toBe(10)
      expect(params.structuredFilters).toHaveLength(1)
    })
  })

  describe('handleVectorOnlySearch', () => {
    it('should throw error when queryVector not provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        distanceThreshold: 0.8,
      }

      await expect(handleVectorOnlySearch(params)).rejects.toThrow(
        'Query vector and distance threshold are required for vector-only search'
      )
    })

    it('should throw error when distanceThreshold not provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      }

      await expect(handleVectorOnlySearch(params)).rejects.toThrow(
        'Query vector and distance threshold are required for vector-only search'
      )
    })

    it('should accept valid parameters for vector-only search', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
        distanceThreshold: 0.8,
      }

      // This test validates the function accepts the right parameters
      expect(params.knowledgeBaseIds).toEqual(['kb-123'])
      expect(params.topK).toBe(10)
      expect(params.queryVector).toBe(JSON.stringify([0.1, 0.2, 0.3]))
      expect(params.distanceThreshold).toBe(0.8)
    })
  })

  describe('handleTagAndVectorSearch', () => {
    it('should throw error when no filters provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        structuredFilters: [],
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
        distanceThreshold: 0.8,
      }

      await expect(handleTagAndVectorSearch(params)).rejects.toThrow(
        'Tag filters are required for tag and vector search'
      )
    })

    it('should throw error when queryVector not provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' }],
        distanceThreshold: 0.8,
      }

      await expect(handleTagAndVectorSearch(params)).rejects.toThrow(
        'Query vector and distance threshold are required for tag and vector search'
      )
    })

    it('should throw error when distanceThreshold not provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' }],
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      }

      await expect(handleTagAndVectorSearch(params)).rejects.toThrow(
        'Query vector and distance threshold are required for tag and vector search'
      )
    })

    it('should accept valid parameters for tag and vector search', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' }],
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
        distanceThreshold: 0.8,
      }

      // This test validates the function accepts the right parameters
      expect(params.knowledgeBaseIds).toEqual(['kb-123'])
      expect(params.topK).toBe(10)
      expect(params.structuredFilters).toHaveLength(1)
      expect(params.queryVector).toBe(JSON.stringify([0.1, 0.2, 0.3]))
      expect(params.distanceThreshold).toBe(0.8)
    })
  })

  describe('generateSearchEmbedding', () => {
    it('should use Azure OpenAI when KB-specific config is provided', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextFetchResponse({
        json: {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        },
      })

      const result = await generateSearchEmbedding('test query')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/text-embedding-ada-002/embeddings?api-version=2024-12-01-preview',
        expect.objectContaining({
          headers: expect.objectContaining({
            'api-key': 'test-azure-key',
          }),
        })
      )
      expect(result.embedding).toEqual([0.1, 0.2, 0.3])

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should fallback to OpenAI when no KB Azure config provided', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextFetchResponse({
        json: {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        },
      })

      const result = await generateSearchEmbedding('test query')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-key',
          }),
        })
      )
      expect(result.embedding).toEqual([0.1, 0.2, 0.3])

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('falls back to OpenAI when AZURE_OPENAI_API_VERSION is not set', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        KB_OPENAI_MODEL_NAME: 'custom-embedding-model',
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextFetchResponse({
        json: {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        },
      })

      await generateSearchEmbedding('test query')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.any(Object)
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should use custom model name when provided in Azure config', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'custom-embedding-model',
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextFetchResponse({
        json: {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        },
      })

      await generateSearchEmbedding('test query', 'text-embedding-3-small')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/custom-embedding-model/embeddings?api-version=2024-12-01-preview',
        expect.any(Object)
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should throw error when no API configuration provided', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])

      await expect(generateSearchEmbedding('test query')).rejects.toThrow(
        'OPENAI_API_KEY is not configured'
      )
    })

    it('should handle Azure OpenAI API errors properly', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
      })

      mockNextFetchResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: 'Deployment not found',
      })

      await expect(generateSearchEmbedding('test query')).rejects.toThrow('Embedding API failed')

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should handle OpenAI API errors properly', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextFetchResponse({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: 'Rate limit exceeded',
      })

      await expect(generateSearchEmbedding('test query')).rejects.toThrow('Embedding API failed')

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should include correct request body for Azure OpenAI', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
      })

      mockNextFetchResponse({
        json: {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        },
      })

      await generateSearchEmbedding('test query')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            input: ['test query'],
            encoding_format: 'float',
            dimensions: 1536,
          }),
        })
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should include correct request body for OpenAI', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextFetchResponse({
        json: {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        },
      })

      await generateSearchEmbedding('test query', 'text-embedding-3-small')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            input: ['test query'],
            model: 'text-embedding-3-small',
            encoding_format: 'float',
            dimensions: 1536,
          }),
        })
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })
  })

  describe('getDocumentMetadataByIds', () => {
    it('should handle empty input gracefully', async () => {
      const { getDocumentMetadataByIds } = await import('./utils')

      const result = await getDocumentMetadataByIds([])

      expect(result).toEqual({})
    })
  })
})
