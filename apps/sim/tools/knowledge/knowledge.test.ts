/**
 * @vitest-environment node
 *
 * Knowledge Tools Unit Tests
 *
 * Tests for knowledge_search and knowledge_upload_chunk tools,
 * specifically the cost restructuring in transformResponse.
 */

import { describe, expect, it } from 'vitest'
import { knowledgeCreateDocumentTool } from '@/tools/knowledge/create_document'
import { knowledgeSearchTool } from '@/tools/knowledge/search'
import { knowledgeUpdateChunkTool } from '@/tools/knowledge/update_chunk'
import { knowledgeUploadChunkTool } from '@/tools/knowledge/upload_chunk'
import { knowledgeUpsertDocumentTool } from '@/tools/knowledge/upsert_document'

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
  it('uses private provenance for search and durable sidecars for persisted content', () => {
    expect(
      knowledgeSearchTool.operation.modelInput?.inputPaths({
        knowledgeBaseId: 'kb-1',
        query: 'search secret',
        apiKey: 'credential',
        tagFilters: [{ tagName: 'team', tagValue: 'support' }],
      })
    ).toEqual([['query']])
    expect(
      knowledgeSearchTool.operation.modelInput?.inputPaths({
        knowledgeBaseId: 'kb-1',
        tagFilters: [{ tagName: 'team', tagValue: 'support' }],
      })
    ).toEqual([['query']])
    expect(
      knowledgeUploadChunkTool.operation.secretProvenance?.request?.({
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        content: 'chunk secret',
      })
    ).toEqual([{ key: 'chunk-content', inputPaths: [['content']] }])
    expect(
      knowledgeUpdateChunkTool.operation.secretProvenance?.request?.({
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        content: 'updated secret',
        enabled: true,
      })
    ).toEqual([{ key: 'chunk-content', inputPaths: [['content']] }])
    expect(
      knowledgeCreateDocumentTool.operation.secretProvenance?.request?.({
        knowledgeBaseId: 'kb-1',
        name: 'document.txt',
        content: 'document secret',
        documentTags: { team: 'support' },
      })
    ).toEqual([
      { key: 'document-filename:0', inputPaths: [['name']] },
      { key: 'document-content:0', inputPaths: [['content']] },
      { key: 'document-tag-value:0:0', inputPaths: [['documentTags', 'team']] },
    ])
    expect(
      knowledgeUpsertDocumentTool.operation.secretProvenance?.request?.({
        knowledgeBaseId: 'kb-1',
        name: 'document.txt',
        content: 'replacement secret',
        documentTags: [{ tagName: 'team', value: 'support' }],
      })
    ).toEqual([
      { key: 'document-filename:0', inputPaths: [['name']] },
      { key: 'document-content:0', inputPaths: [['content']] },
      { key: 'document-tag-value:0:0', inputPaths: [['documentTags', '0', 'value']] },
    ])

    expect(knowledgeSearchTool.operation.modelInput?.mode).toBe('private-provenance')
    expect(knowledgeUploadChunkTool.operation.modelInput).toBeUndefined()
    expect(knowledgeUpdateChunkTool.operation.modelInput).toBeUndefined()
    expect(knowledgeCreateDocumentTool.operation.modelInput).toBeUndefined()
    expect(knowledgeUpsertDocumentTool.operation.modelInput).toBeUndefined()
    expect(knowledgeUploadChunkTool.operation.secretProvenance?.response).toEqual({
      incomplete: 'reject',
    })
    expect(knowledgeUpdateChunkTool.operation.secretProvenance?.response).toEqual({
      incomplete: 'reject',
    })
    expect(knowledgeCreateDocumentTool.operation.secretProvenance?.response).toEqual({
      incomplete: 'reject',
    })
    expect(knowledgeUpsertDocumentTool.operation.secretProvenance?.response).toEqual({
      incomplete: 'reject',
    })
  })

  it('keeps persisted request values raw while provenance travels out of band', () => {
    const createBody = knowledgeCreateDocumentTool.operation.input({
      knowledgeBaseId: 'kb-1',
      name: '{{DOCUMENT_NAME}}.txt',
      content: '{{API_KEY}}',
      documentTags: { team: '{{TEAM_SECRET}}' },
    }) as {
      documents: Array<{ filename: string; fileUrl: string; documentTagsData?: string }>
    }
    const createEncoded = createBody.documents[0].fileUrl.split(',')[1]
    expect(Buffer.from(createEncoded, 'base64').toString('utf8')).toBe('{{API_KEY}}')
    expect(createBody.documents[0].filename).toBe('{{DOCUMENT_NAME}}.txt')
    expect(createBody.documents[0].documentTagsData).toBe(
      '[{"tagName":"team","value":"{{TEAM_SECRET}}"}]'
    )

    const upsertBody = knowledgeUpsertDocumentTool.operation.input({
      knowledgeBaseId: 'kb-1',
      name: '{{DOCUMENT_NAME}}.txt',
      content: 'Bearer {{API_KEY}}',
      documentTags: [{ tagName: 'team', value: 'Bearer {{TEAM_SECRET}}' }],
    }) as { filename: string; fileUrl: string; documentTagsData?: string }
    const upsertEncoded = upsertBody.fileUrl.split(',')[1]
    expect(Buffer.from(upsertEncoded, 'base64').toString('utf8')).toBe('Bearer {{API_KEY}}')
    expect(upsertBody.filename).toBe('{{DOCUMENT_NAME}}.txt')
    expect(upsertBody.documentTagsData).toBe(
      '[{"tagName":"team","value":"Bearer {{TEAM_SECRET}}"}]'
    )

    expect(
      knowledgeUploadChunkTool.operation.input({
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        content: '{{API_KEY}}',
      })
    ).toEqual({
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-1',
      content: '{{API_KEY}}',
      enabled: true,
    })
    expect(
      knowledgeUpdateChunkTool.operation.input({
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        content: 'Bearer {{API_KEY}}',
      })
    ).toEqual({
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-1',
      chunkId: 'chunk-1',
      content: 'Bearer {{API_KEY}}',
    })
  })

  describe('knowledgeCreateDocumentTool', () => {
    describe('transformResponse', () => {
      it('exposes the created document ID at both the top level and nested data path', async () => {
        const result = await knowledgeCreateDocumentTool.transformResponse!(
          createMockResponse({
            data: {
              documentsCreated: [{ documentId: 'doc-123', filename: 'document.txt' }],
            },
          })
        )

        expect(result.success).toBe(true)
        expect(result.output.documentId).toBe('doc-123')
        expect(result.output.data.documentId).toBe('doc-123')
      })

      it('uses the legacy document ID fallback for both output paths', async () => {
        const result = await knowledgeCreateDocumentTool.transformResponse!(
          createMockResponse({
            documentsCreated: [{ id: 'legacy-doc-123', filename: 'document.txt' }],
          })
        )

        expect(result.output.documentId).toBe('legacy-doc-123')
        expect(result.output.data.documentId).toBe('legacy-doc-123')
      })

      it('preserves empty IDs when no documents are created', async () => {
        const result = await knowledgeCreateDocumentTool.transformResponse!(
          createMockResponse({ data: { documentsCreated: [] } })
        )

        expect(result.success).toBe(true)
        expect(result.output.documentId).toBe('')
        expect(result.output.data.documentId).toBe('')
      })
    })
  })

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

        const result = await knowledgeSearchTool.transformResponse!(createMockResponse(apiResponse))

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

        const result = await knowledgeSearchTool.transformResponse!(createMockResponse(apiResponse))

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

        const result = await knowledgeSearchTool.transformResponse!(createMockResponse(apiResponse))

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
