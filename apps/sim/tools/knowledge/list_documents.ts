import type { KnowledgeListDocumentsResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeListDocumentsTool: ToolConfig<any, KnowledgeListDocumentsResponse> = {
  id: 'knowledge_list_documents',
  name: 'Knowledge List Documents',
  description: 'List documents in a knowledge base with optional filtering, search, and pagination',
  version: '1.0.0',

  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base to list documents from',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter documents by filename',
    },
    enabledFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by enabled status: "all", "enabled", or "disabled"',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of documents to return (default: 50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of documents to skip for pagination (default: 0)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.search) queryParams.set('search', params.search)
      if (params.enabledFilter) queryParams.set('enabledFilter', params.enabledFilter)
      if (params.limit) queryParams.set('limit', String(params.limit))
      if (params.offset) queryParams.set('offset', String(params.offset))
      const qs = queryParams.toString()
      return `/api/knowledge/${params.knowledgeBaseId}/documents${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params): Promise<KnowledgeListDocumentsResponse> => {
    const result = await response.json()
    const data = result.data || {}
    const documents = data.documents || []
    const pagination = data.pagination || {}

    return {
      success: true,
      output: {
        knowledgeBaseId: params?.knowledgeBaseId ?? '',
        documents: documents.map(
          (doc: {
            id: string
            filename: string
            fileSize: number
            mimeType: string
            enabled: boolean
            processingStatus: string
            chunkCount: number
            tokenCount: number
            uploadedAt: string
            updatedAt: string
          }) => ({
            id: doc.id,
            filename: doc.filename,
            fileSize: doc.fileSize ?? 0,
            mimeType: doc.mimeType ?? null,
            enabled: doc.enabled ?? true,
            processingStatus: doc.processingStatus ?? null,
            chunkCount: doc.chunkCount ?? 0,
            tokenCount: doc.tokenCount ?? 0,
            uploadedAt: doc.uploadedAt ?? null,
            updatedAt: doc.updatedAt ?? null,
          })
        ),
        totalDocuments: pagination.total ?? documents.length,
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
    documents: {
      type: 'array',
      description: 'Array of documents in the knowledge base',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Document ID' },
          filename: { type: 'string', description: 'Document filename' },
          fileSize: { type: 'number', description: 'File size in bytes' },
          mimeType: { type: 'string', description: 'MIME type of the document' },
          enabled: { type: 'boolean', description: 'Whether the document is enabled' },
          processingStatus: {
            type: 'string',
            description: 'Processing status (pending, processing, completed, failed)',
          },
          chunkCount: { type: 'number', description: 'Number of chunks in the document' },
          tokenCount: { type: 'number', description: 'Total token count across chunks' },
          uploadedAt: { type: 'string', description: 'Upload timestamp' },
          updatedAt: { type: 'string', description: 'Last update timestamp' },
        },
      },
    },
    totalDocuments: {
      type: 'number',
      description: 'Total number of documents matching the filter',
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
