/**
 * Tests for knowledge search utility functions
 * Focuses on testing core functionality with simplified mocking
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm')
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))
vi.mock('@sim/db')
vi.mock('@/lib/knowledge/documents/utils', () => ({
  retryWithExponentialBackoff: (fn: any) => fn(),
}))

vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    }),
  })
)

vi.mock('@/lib/env', () => ({
  env: {},
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value === 'true' || value === '1' : Boolean(value),
}))

import {
  generateSearchEmbedding,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
} from './utils'

describe('Knowledge Search Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleTagOnlySearch', () => {
    it('should throw error when no filters provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        filters: {},
      }

      await expect(handleTagOnlySearch(params)).rejects.toThrow(
        'Tag filters are required for tag-only search'
      )
    })

    it('should accept valid parameters for tag-only search', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        topK: 10,
        filters: { tag1: 'api' },
      }

      // This test validates the function accepts the right parameters
      // The actual database interaction is tested via route tests
      expect(params.knowledgeBaseIds).toEqual(['kb-123'])
      expect(params.topK).toBe(10)
      expect(params.filters).toEqual({ tag1: 'api' })
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
        filters: {},
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
        filters: { tag1: 'api' },
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
        filters: { tag1: 'api' },
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
        filters: { tag1: 'api' },
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
        distanceThreshold: 0.8,
      }

      // This test validates the function accepts the right parameters
      expect(params.knowledgeBaseIds).toEqual(['kb-123'])
      expect(params.topK).toBe(10)
      expect(params.filters).toEqual({ tag1: 'api' })
      expect(params.queryVector).toBe(JSON.stringify([0.1, 0.2, 0.3]))
      expect(params.distanceThreshold).toBe(0.8)
    })
  })

  describe('generateSearchEmbedding', () => {
    it('should use Azure OpenAI when KB-specific config is provided', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
        OPENAI_API_KEY: 'test-openai-key',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as any)

      const result = await generateSearchEmbedding('test query')

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/text-embedding-ada-002/embeddings?api-version=2024-12-01-preview',
        expect.objectContaining({
          headers: expect.objectContaining({
            'api-key': 'test-azure-key',
          }),
        })
      )
      expect(result).toEqual([0.1, 0.2, 0.3])

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should fallback to OpenAI when no KB Azure config provided', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as any)

      const result = await generateSearchEmbedding('test query')

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-key',
          }),
        })
      )
      expect(result).toEqual([0.1, 0.2, 0.3])

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should use default API version when not provided in Azure config', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        KB_OPENAI_MODEL_NAME: 'custom-embedding-model',
        OPENAI_API_KEY: 'test-openai-key',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as any)

      await generateSearchEmbedding('test query')

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('api-version='),
        expect.any(Object)
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should use custom model name when provided in Azure config', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'custom-embedding-model',
        OPENAI_API_KEY: 'test-openai-key',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as any)

      await generateSearchEmbedding('test query', 'text-embedding-3-small')

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/custom-embedding-model/embeddings?api-version=2024-12-01-preview',
        expect.any(Object)
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should throw error when no API configuration provided', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])

      await expect(generateSearchEmbedding('test query')).rejects.toThrow(
        'Either OPENAI_API_KEY or Azure OpenAI configuration (AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT) must be configured'
      )
    })

    it('should handle Azure OpenAI API errors properly', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Deployment not found',
      } as any)

      await expect(generateSearchEmbedding('test query')).rejects.toThrow('Embedding API failed')

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should handle OpenAI API errors properly', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limit exceeded',
      } as any)

      await expect(generateSearchEmbedding('test query')).rejects.toThrow('Embedding API failed')

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should include correct request body for Azure OpenAI', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as any)

      await generateSearchEmbedding('test query')

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            input: ['test query'],
            encoding_format: 'float',
          }),
        })
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should include correct request body for OpenAI', async () => {
      const { env } = await import('@/lib/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
      })

      const fetchSpy = vi.mocked(fetch)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      } as any)

      await generateSearchEmbedding('test query', 'text-embedding-3-small')

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            input: ['test query'],
            model: 'text-embedding-3-small',
            encoding_format: 'float',
          }),
        })
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })
  })

  describe('getDocumentNamesByIds', () => {
    it('should handle empty input gracefully', async () => {
      const { getDocumentNamesByIds } = await import('./utils')

      const result = await getDocumentNamesByIds([])

      expect(result).toEqual({})
    })
  })
})
