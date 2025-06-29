import type { ToolConfig } from '../types'
import type { KnowledgeUploadDocumentResponse } from './types'

export const knowledgeUploadDocumentTool: ToolConfig<any, KnowledgeUploadDocumentResponse> = {
  id: 'knowledge_upload_document',
  name: 'Knowledge Upload Document',
  description: 'Upload documents to a knowledge base',
  version: '1.0.0',
  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      description: 'ID of the knowledge base containing the document',
    },
    knowledgeBaseName: {
      type: 'string',
      required: true,
      description: 'Name of the knowledge base to upload the document to',
    },
    file: {
      type: 'file',
      required: true,
      description: 'Document(s) to upload',
    },
  },
  request: {
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/documents`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Handle both single file and array of files from FileUpload component
      const files = Array.isArray(params.file) ? params.file : [params.file]

      // Map files to the expected document format
      const documents = files.map(
        (fileData: { name: string; path: string; size: number; type: string }) => {
          // Create file URL (handle both relative and absolute paths)
          const fileUrl = fileData.path?.startsWith('http')
            ? fileData.path
            : `${typeof window !== 'undefined' ? window.location.origin : ''}${fileData.path}`

          return {
            filename: fileData.name,
            fileUrl: fileUrl,
            fileSize: fileData.size,
            mimeType: fileData.type,
          }
        }
      )

      // Use bulk upload format (required for processing)
      const requestBody = {
        documents: documents,
        processingOptions: {
          chunkSize: 1024,
          minCharactersPerChunk: 100,
          chunkOverlap: 200,
          recipe: 'default',
          lang: 'en',
        },
        bulk: true,
      }

      return requestBody
    },
    isInternalRoute: true,
  },
  transformResponse: async (response): Promise<KnowledgeUploadDocumentResponse> => {
    try {
      const result = await response.json()

      if (!response.ok) {
        const errorMessage = result.error?.message || result.message || 'Failed to upload documents'
        throw new Error(errorMessage)
      }

      const data = result.data || result
      const documentsCreated = data.documentsCreated || []

      // Handle multiple documents response
      const uploadCount = documentsCreated.length
      const firstDocument = documentsCreated[0]

      return {
        success: true,
        output: {
          data: {
            id: firstDocument?.documentId || firstDocument?.id || '',
            name:
              uploadCount > 1 ? `${uploadCount} documents` : firstDocument?.filename || 'Unknown',
            size: 0, // Size not returned in bulk response
            type: 'document',
            url: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            enabled: true,
          },
          message:
            uploadCount > 1
              ? `Successfully uploaded ${uploadCount} documents to knowledge base`
              : `Successfully uploaded document to knowledge base`,
          documentId: firstDocument?.documentId || firstDocument?.id || '',
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          data: {
            id: '',
            name: '',
            size: 0,
            type: '',
            url: '',
            enabled: true,
            createdAt: '',
            updatedAt: '',
          },
          message: `Failed to upload documents: ${error.message || 'Unknown error'}`,
          documentId: '',
        },
        error: `Failed to upload documents: ${error.message || 'Unknown error'}`,
      }
    }
  },
  transformError: async (error): Promise<KnowledgeUploadDocumentResponse> => {
    const errorMessage = `Failed to upload documents: ${error.message || 'Unknown error'}`
    return {
      success: false,
      output: {
        data: {
          id: '',
          name: '',
          size: 0,
          type: '',
          url: '',
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
