import type { KnowledgeUploadChunkResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeUploadChunkTool: ToolConfig<any, KnowledgeUploadChunkResponse> = {
  id: 'knowledge_upload_chunk',
  name: 'Knowledge Upload Chunk',
  description: 'Upload a new chunk to a document in a knowledge base',
  version: '1.0.0',

  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      description: 'ID of the knowledge base containing the document',
    },
    documentId: {
      type: 'string',
      required: true,
      description: 'ID of the document to upload the chunk to',
    },
    content: {
      type: 'string',
      required: true,
      description: 'Content of the chunk to upload',
    },
  },

  request: {
    url: (params) =>
      `/api/knowledge/${params.knowledgeBaseId}/documents/${params.documentId}/chunks`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const workflowId = params._context?.workflowId

      const requestBody = {
        content: params.content,
        enabled: true,
        ...(workflowId && { workflowId }),
      }

      return requestBody
    },
  },

  transformResponse: async (response): Promise<KnowledgeUploadChunkResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        data: {
          id: data.id,
          chunkIndex: data.chunkIndex || 0,
          content: data.content,
          contentLength: data.contentLength || data.content?.length || 0,
          tokenCount: data.tokenCount || 0,
          enabled: data.enabled !== undefined ? data.enabled : true,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        },
        message: `Successfully uploaded chunk to document`,
        documentId: data.documentId,
        cost: data.cost,
      },
    }
  },

  outputs: {
    data: {
      type: 'object',
      description: 'Information about the uploaded chunk',
      properties: {
        id: { type: 'string', description: 'Chunk ID' },
        chunkIndex: { type: 'number', description: 'Index of the chunk within the document' },
        content: { type: 'string', description: 'Content of the chunk' },
        contentLength: { type: 'number', description: 'Length of the content in characters' },
        tokenCount: { type: 'number', description: 'Number of tokens in the chunk' },
        enabled: { type: 'boolean', description: 'Whether the chunk is enabled' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
      },
    },
    message: {
      type: 'string',
      description: 'Success or error message describing the operation result',
    },
    documentId: {
      type: 'string',
      description: 'ID of the document the chunk was added to',
    },
    cost: {
      type: 'object',
      description: 'Cost information for the upload operation',
      optional: true,
    },
  },
}
