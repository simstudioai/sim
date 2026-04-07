import type { KnowledgeDeleteDocumentResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeDeleteDocumentTool: ToolConfig<any, KnowledgeDeleteDocumentResponse> = {
  id: 'knowledge_delete_document',
  name: 'Knowledge Delete Document',
  description: 'Delete a document from a knowledge base',
  version: '1.0.0',

  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base containing the document',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the document to delete',
    },
  },

  request: {
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/documents/${params.documentId}`,
    method: 'DELETE',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params): Promise<KnowledgeDeleteDocumentResponse> => {
    const result = await response.json()

    return {
      success: true,
      output: {
        documentId: params?.documentId ?? '',
        message: result.data?.message ?? 'Document deleted successfully',
      },
    }
  },

  outputs: {
    documentId: {
      type: 'string',
      description: 'ID of the deleted document',
    },
    message: {
      type: 'string',
      description: 'Confirmation message',
    },
  },
}
