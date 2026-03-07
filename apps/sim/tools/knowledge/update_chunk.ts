import type { KnowledgeUpdateChunkResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeUpdateChunkTool: ToolConfig<any, KnowledgeUpdateChunkResponse> = {
  id: 'knowledge_update_chunk',
  name: 'Knowledge Update Chunk',
  description: 'Update the content or enabled status of a chunk in a knowledge base',
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
      description: 'ID of the chunk to update',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New content for the chunk',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the chunk should be enabled or disabled',
    },
  },

  request: {
    url: (params) =>
      `/api/knowledge/${params.knowledgeBaseId}/documents/${params.documentId}/chunks/${params.chunkId}`,
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.content !== undefined) body.content = params.content
      if (params.enabled !== undefined) body.enabled = params.enabled
      return body
    },
  },

  transformResponse: async (response, params): Promise<KnowledgeUpdateChunkResponse> => {
    const result = await response.json()
    const chunk = result.data || {}

    return {
      success: true,
      output: {
        documentId: params?.documentId ?? '',
        id: chunk.id ?? '',
        chunkIndex: chunk.chunkIndex ?? 0,
        content: chunk.content ?? '',
        contentLength: chunk.contentLength ?? 0,
        tokenCount: chunk.tokenCount ?? 0,
        enabled: chunk.enabled ?? true,
        updatedAt: chunk.updatedAt ?? null,
      },
    }
  },

  outputs: {
    documentId: {
      type: 'string',
      description: 'ID of the parent document',
    },
    id: {
      type: 'string',
      description: 'Chunk ID',
    },
    chunkIndex: {
      type: 'number',
      description: 'Index of the chunk within the document',
    },
    content: {
      type: 'string',
      description: 'Updated chunk content',
    },
    contentLength: {
      type: 'number',
      description: 'Content length in characters',
    },
    tokenCount: {
      type: 'number',
      description: 'Token count for the chunk',
    },
    enabled: {
      type: 'boolean',
      description: 'Whether the chunk is enabled',
    },
    updatedAt: {
      type: 'string',
      description: 'Last update timestamp',
      optional: true,
    },
  },
}
