import type { ToolConfig } from '../types'
import type { KnowledgeUploadChunkResponse } from './types'

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
    isInternalRoute: true,
  },
  transformResponse: async (response): Promise<KnowledgeUploadChunkResponse> => {
    try {
      const result = await response.json()

      if (!response.ok) {
        const errorMessage = result.error?.message || result.message || 'Failed to upload chunk'
        throw new Error(errorMessage)
      }

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
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          data: {
            id: '',
            chunkIndex: 0,
            content: '',
            contentLength: 0,
            tokenCount: 0,
            enabled: true,
            createdAt: '',
            updatedAt: '',
          },
          message: `Failed to upload chunk: ${error.message || 'Unknown error'}`,
          documentId: '',
        },
        error: `Failed to upload chunk: ${error.message || 'Unknown error'}`,
      }
    }
  },
  transformError: async (error): Promise<KnowledgeUploadChunkResponse> => {
    const errorMessage = `Failed to upload chunk: ${error.message || 'Unknown error'}`
    return {
      success: false,
      output: {
        data: {
          id: '',
          chunkIndex: 0,
          content: '',
          contentLength: 0,
          tokenCount: 0,
          enabled: true,
          createdAt: '',
          updatedAt: '',
        },
        message: errorMessage,
        documentId: '',
      },
      error: errorMessage,
    }
  },
}
