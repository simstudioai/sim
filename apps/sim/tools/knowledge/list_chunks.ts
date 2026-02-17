import type { KnowledgeListChunksResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeListChunksTool: ToolConfig<any, KnowledgeListChunksResponse> = {
  id: 'knowledge_list_chunks',
  name: 'Knowledge List Chunks',
  description:
    'List chunks for a document in a knowledge base with optional filtering and pagination',
  version: '1.0.0',

  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the document to list chunks from',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter chunks by content',
    },
    enabled: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by enabled status: "true", "false", or "all" (default: "all")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of chunks to return (1-100, default: 50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of chunks to skip for pagination (default: 0)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.search) queryParams.set('search', params.search)
      if (params.enabled) queryParams.set('enabled', params.enabled)
      if (params.limit)
        queryParams.set('limit', String(Math.max(1, Math.min(100, Number(params.limit)))))
      if (params.offset) queryParams.set('offset', String(params.offset))
      const qs = queryParams.toString()
      return `/api/knowledge/${params.knowledgeBaseId}/documents/${params.documentId}/chunks${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params): Promise<KnowledgeListChunksResponse> => {
    const result = await response.json()
    const chunks = result.data || []
    const pagination = result.pagination || {}

    return {
      success: true,
      output: {
        knowledgeBaseId: params?.knowledgeBaseId ?? '',
        documentId: params?.documentId ?? '',
        chunks: chunks.map(
          (chunk: {
            id: string
            chunkIndex: number
            content: string
            contentLength: number
            tokenCount: number
            enabled: boolean
            createdAt: string
            updatedAt: string
          }) => ({
            id: chunk.id,
            chunkIndex: chunk.chunkIndex ?? 0,
            content: chunk.content,
            contentLength: chunk.contentLength ?? 0,
            tokenCount: chunk.tokenCount ?? 0,
            enabled: chunk.enabled ?? true,
            createdAt: chunk.createdAt ?? null,
            updatedAt: chunk.updatedAt ?? null,
          })
        ),
        totalChunks: pagination.total ?? chunks.length,
        limit: pagination.limit ?? 50,
        offset: pagination.offset ?? 0,
      },
    }
  },

  outputs: {
    knowledgeBaseId: {
      type: 'string',
      description: 'ID of the knowledge base',
    },
    documentId: {
      type: 'string',
      description: 'ID of the document',
    },
    chunks: {
      type: 'array',
      description: 'Array of chunks in the document',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Chunk ID' },
          chunkIndex: { type: 'number', description: 'Index of the chunk within the document' },
          content: { type: 'string', description: 'Chunk text content' },
          contentLength: { type: 'number', description: 'Content length in characters' },
          tokenCount: { type: 'number', description: 'Token count for the chunk' },
          enabled: { type: 'boolean', description: 'Whether the chunk is enabled' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last update timestamp' },
        },
      },
    },
    totalChunks: {
      type: 'number',
      description: 'Total number of chunks matching the filter',
    },
    limit: {
      type: 'number',
      description: 'Page size used',
    },
    offset: {
      type: 'number',
      description: 'Offset used for pagination',
    },
  },
}
