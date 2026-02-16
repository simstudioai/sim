/**
 * @vitest-environment node
 *
 * Knowledge Tools Unit Tests
 *
 * Tests for knowledge_search and knowledge_upload_chunk tools,
 * specifically the cost restructuring in transformResponse.
 */

import { describe, expect, it } from 'vitest'
import { knowledgeSearchTool } from '@/tools/knowledge/search'
import { knowledgeUploadChunkTool } from '@/tools/knowledge/upload_chunk'

/**
 * Creates a mock Response object for testing transformResponse
 */
function createMockResponse(data: unknown): Response {
  return {
    json: async () => data,
    ok: true,
    status: 200,
  } as Response
}

describe('Knowledge Tools', () => {
  describe('knowledgeSearchTool', () => {
    describe('transformResponse', () => {
      it('should restructure cost information for logging', async () => {
        const apiResponse = {
          data: {
            results: [{ content: 'test result', similarity: 0.95 }],
            query: 'test query',
            totalResults: 1,
            cost: {
              input: 0.00001042,
              output: 0,
              total: 0.00001042,
              tokens: {
                prompt: 521,
                completion: 0,
                total: 521,
              },
              model: 'text-embedding-3-small',
              pricing: {
                input: 0.02,
                output: 0,
                updatedAt: '2025-07-10',
              },
            },
          },
        }

        const result = await knowledgeSearchTool.transformResponse!(
          createMockResponse(apiResponse)
        )

        expect(result.success).toBe(true)
        expect(result.output).toEqual({
          results: [{ content: 'test result', similarity: 0.95 }],
          query: 'test query',
          totalResults: 1,
          cost: {
            input: 0.00001042,
            output: 0,
            total: 0.00001042,
          },
          tokens: {
            prompt: 521,
            completion: 0,
            total: 521,
          },
          model: 'text-embedding-3-small',
        })
      })

      it('should handle response without cost information', async () => {
        const apiResponse = {
          data: {
            results: [],
            query: 'test query',
            totalResults: 0,
          },
        }

        const result = await knowledgeSearchTool.transformResponse!(
          createMockResponse(apiResponse)
        )

        expect(result.success).toBe(true)
        expect(result.output).toEqual({
          results: [],
          query: 'test query',
          totalResults: 0,
        })
        expect(result.output.cost).toBeUndefined()
        expect(result.output.tokens).toBeUndefined()
        expect(result.output.model).toBeUndefined()
      })

      it('should handle response with partial cost information', async () => {
        const apiResponse = {
          data: {
            results: [],
            query: 'test query',
            totalResults: 0,
            cost: {
              input: 0.001,
              output: 0,
              total: 0.001,
              // No tokens or model
            },
          },
        }

        const result = await knowledgeSearchTool.transformResponse!(
          createMockResponse(apiResponse)
        )

        expect(result.success).toBe(true)
        expect(result.output.cost).toEqual({
          input: 0.001,
          output: 0,
          total: 0.001,
        })
        expect(result.output.tokens).toBeUndefined()
        expect(result.output.model).toBeUndefined()
      })
    })
  })

  describe('knowledgeUploadChunkTool', () => {
    describe('transformResponse', () => {
      it('should restructure cost information for logging', async () => {
        const apiResponse = {
          data: {
            id: 'chunk-123',
            chunkIndex: 0,
            content: 'test content',
            contentLength: 12,
            tokenCount: 3,
            enabled: true,
            documentId: 'doc-456',
            documentName: 'Test Document',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            cost: {
              input: 0.00000521,
              output: 0,
              total: 0.00000521,
              tokens: {
                prompt: 260,
                completion: 0,
                total: 260,
              },
              model: 'text-embedding-3-small',
              pricing: {
                input: 0.02,
                output: 0,
                updatedAt: '2025-07-10',
              },
            },
          },
        }

        const result = await knowledgeUploadChunkTool.transformResponse!(
          createMockResponse(apiResponse)
        )

        expect(result.success).toBe(true)
        expect(result.output.cost).toEqual({
          input: 0.00000521,
          output: 0,
          total: 0.00000521,
        })
        expect(result.output.tokens).toEqual({
          prompt: 260,
          completion: 0,
          total: 260,
        })
        expect(result.output.model).toBe('text-embedding-3-small')
        expect(result.output.data.chunkId).toBe('chunk-123')
        expect(result.output.documentId).toBe('doc-456')
      })

      it('should handle response without cost information', async () => {
        const apiResponse = {
          data: {
            id: 'chunk-123',
            chunkIndex: 0,
            content: 'test content',
            documentId: 'doc-456',
            documentName: 'Test Document',
          },
        }

        const result = await knowledgeUploadChunkTool.transformResponse!(
          createMockResponse(apiResponse)
        )

        expect(result.success).toBe(true)
        expect(result.output.cost).toBeUndefined()
        expect(result.output.tokens).toBeUndefined()
        expect(result.output.model).toBeUndefined()
        expect(result.output.data.chunkId).toBe('chunk-123')
      })
    })
  })
})
