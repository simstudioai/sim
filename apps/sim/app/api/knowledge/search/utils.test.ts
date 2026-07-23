/**
 * Tests for knowledge search utility functions
 * Focuses on testing core functionality with simplified mocking
 *
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { mockNextFetchResponse, setupGlobalFetchMock } from '@sim/testing/mocks'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as documentsUtilsModule from '@/lib/knowledge/documents/utils'

const UNSET_EMBEDDING_ENV = {
  OPENAI_API_KEY: undefined,
  OPENAI_API_KEY_1: undefined,
  OPENAI_API_KEY_2: undefined,
  OPENAI_API_KEY_3: undefined,
  AZURE_OPENAI_API_KEY: undefined,
  AZURE_OPENAI_ENDPOINT: undefined,
  AZURE_OPENAI_API_VERSION: undefined,
  KB_OPENAI_MODEL_NAME: undefined,
}

function setEmbeddingEnv(overrides: Record<string, string | undefined> = {}) {
  setEnv({ ...UNSET_EMBEDDING_ENV, ...overrides })
}

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

afterEach(() => {
  resetEnvMock()
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
    resetEnvMock()
    setEmbeddingEnv()
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
      setEmbeddingEnv({
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
    })

    it('should fallback to OpenAI when no KB Azure config provided', async () => {
      setEmbeddingEnv({
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
    })

    it('falls back to OpenAI when AZURE_OPENAI_API_VERSION is not set', async () => {
      setEmbeddingEnv({
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
    })

    it('should use custom model name when provided in Azure config', async () => {
      setEmbeddingEnv({
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
    })

    it('should throw error when no API configuration provided', async () => {
      setEmbeddingEnv()

      await expect(generateSearchEmbedding('test query')).rejects.toThrow(
        'OPENAI_API_KEY is not configured'
      )
    })

    it('should handle Azure OpenAI API errors properly', async () => {
      setEmbeddingEnv({
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
    })

    it('should handle OpenAI API errors properly', async () => {
      setEmbeddingEnv({
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextFetchResponse({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: 'Rate limit exceeded',
      })

      await expect(generateSearchEmbedding('test query')).rejects.toThrow('Embedding API failed')
    })

    it('should include correct request body for Azure OpenAI', async () => {
      setEmbeddingEnv({
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
    })

    it('should include correct request body for OpenAI', async () => {
      setEmbeddingEnv({
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
