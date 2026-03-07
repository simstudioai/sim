import type { KnowledgeGetDocumentResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeGetDocumentTool: ToolConfig<any, KnowledgeGetDocumentResponse> = {
  id: 'knowledge_get_document',
  name: 'Knowledge Get Document',
  description:
    'Get full details of a single document including tags, connector metadata, and processing status',
  version: '1.0.0',

  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base the document belongs to',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the document to retrieve',
    },
  },

  request: {
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/documents/${params.documentId}`,
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<KnowledgeGetDocumentResponse> => {
    const result = await response.json()
    const doc = result.data || {}

    const tagSlots = [
      'tag1',
      'tag2',
      'tag3',
      'tag4',
      'tag5',
      'tag6',
      'tag7',
      'number1',
      'number2',
      'number3',
      'number4',
      'number5',
      'date1',
      'date2',
      'boolean1',
      'boolean2',
      'boolean3',
    ]
    const tags: Record<string, unknown> = {}
    for (const slot of tagSlots) {
      if (doc[slot] !== null && doc[slot] !== undefined) {
        tags[slot] = doc[slot]
      }
    }

    return {
      success: result.success ?? true,
      output: {
        id: doc.id,
        filename: doc.filename,
        fileSize: doc.fileSize ?? 0,
        mimeType: doc.mimeType ?? null,
        enabled: doc.enabled ?? true,
        processingStatus: doc.processingStatus ?? null,
        processingError: doc.processingError ?? null,
        chunkCount: doc.chunkCount ?? 0,
        tokenCount: doc.tokenCount ?? 0,
        characterCount: doc.characterCount ?? 0,
        uploadedAt: doc.uploadedAt ?? null,
        updatedAt: doc.updatedAt ?? null,
        connectorId: doc.connectorId ?? null,
        sourceUrl: doc.sourceUrl ?? null,
        externalId: doc.externalId ?? null,
        tags,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Document ID' },
    filename: { type: 'string', description: 'Document filename' },
    fileSize: { type: 'number', description: 'File size in bytes' },
    mimeType: { type: 'string', description: 'MIME type of the document' },
    enabled: { type: 'boolean', description: 'Whether the document is enabled' },
    processingStatus: {
      type: 'string',
      description: 'Processing status (pending, processing, completed, failed)',
    },
    processingError: {
      type: 'string',
      description: 'Error message if processing failed',
    },
    chunkCount: { type: 'number', description: 'Number of chunks in the document' },
    tokenCount: { type: 'number', description: 'Total token count across chunks' },
    characterCount: { type: 'number', description: 'Total character count' },
    uploadedAt: { type: 'string', description: 'Upload timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    connectorId: {
      type: 'string',
      description: 'Connector ID if document was synced from an external source',
    },
    sourceUrl: {
      type: 'string',
      description: 'Original URL in the source system if synced from a connector',
    },
    externalId: {
      type: 'string',
      description: 'External ID from the source system',
    },
    tags: {
      type: 'object',
      description: 'Tag values keyed by tag slot (tag1-7, number1-5, date1-2, boolean1-3)',
    },
  },
}
