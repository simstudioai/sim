import type { KnowledgeDeleteChunkResponse } from '@/tools/knowledge/types'
import type { InternalToolConfig } from '@/tools/types'

export const knowledgeDeleteChunkTool: InternalToolConfig<any, KnowledgeDeleteChunkResponse> = {
  id: 'knowledge_delete_chunk',
  name: 'Knowledge Delete Chunk',
  description: 'Delete a chunk from a document in a knowledge base',
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
      description: 'ID of the document containing the chunk',
    },
    chunkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the chunk to delete',
    },
  },

  operation: {
    input: (params) => ({
      knowledgeBaseId: params.knowledgeBaseId,
      documentId: params.documentId,
      chunkId: params.chunkId,
    }),
  },

  transformResponse: async (response, params): Promise<KnowledgeDeleteChunkResponse> => {
    const result = await response.json()

    return {
      success: true,
      output: {
        chunkId: params?.chunkId ?? '',
        documentId: params?.documentId ?? '',
        message: result.data?.message ?? 'Chunk deleted successfully',
      },
    }
  },

  outputs: {
    chunkId: {
      type: 'string',
      description: 'ID of the deleted chunk',
    },
    documentId: {
      type: 'string',
      description: 'ID of the parent document',
    },
    message: {
      type: 'string',
      description: 'Confirmation message',
    },
  },
}
