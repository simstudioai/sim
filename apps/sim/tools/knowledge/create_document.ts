import type { ToolConfig } from '../types'
import type { KnowledgeCreateDocumentResponse } from './types'

export const knowledgeCreateDocumentTool: ToolConfig<any, KnowledgeCreateDocumentResponse> = {
  id: 'knowledge_create_document',
  name: 'Knowledge Create Document',
  description: 'Create a new document in a knowledge base',
  version: '1.0.0',
  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      description: 'ID of the knowledge base containing the document',
    },
    name: {
      type: 'string',
      required: true,
      description: 'Name of the document',
    },
    content: {
      type: 'string',
      required: true,
      description: 'Content of the document',
    },
  },
  request: {
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/documents`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const textContent = params.content?.trim()
      const documentName = params.name?.trim()

      if (!documentName || documentName.length === 0) {
        throw new Error('Document name is required')
      }
      if (documentName.length > 255) {
        throw new Error('Document name must be 255 characters or less')
      }
      if (/[<>:"/\\|?*]/.test(documentName)) {
        throw new Error('Document name contains invalid characters. Avoid: < > : " / \\ | ? *')
      }
      if (!textContent || textContent.length < 10) {
        throw new Error('Document content must be at least 10 characters long')
      }
      if (textContent.length > 1000000) {
        throw new Error('Document content exceeds maximum size of 1MB')
      }

      const contentBytes = new TextEncoder().encode(textContent).length

      const utf8Bytes = new TextEncoder().encode(textContent)
      const base64Content =
        typeof Buffer !== 'undefined'
          ? Buffer.from(textContent, 'utf8').toString('base64')
          : btoa(String.fromCharCode(...utf8Bytes))

      const dataUri = `data:text/plain;base64,${base64Content}`

      const documents = [
        {
          filename: documentName.endsWith('.txt') ? documentName : `${documentName}.txt`,
          fileUrl: dataUri,
          fileSize: contentBytes,
          mimeType: 'text/plain',
        },
      ]

      return {
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
    },
    isInternalRoute: true,
  },
  transformResponse: async (response): Promise<KnowledgeCreateDocumentResponse> => {
    try {
      const result = await response.json()

      if (!response.ok) {
        const errorMessage = result.error?.message || result.message || 'Failed to create document'
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
            type: 'document',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            enabled: true,
          },
          message:
            uploadCount > 1
              ? `Successfully created ${uploadCount} documents in knowledge base`
              : `Successfully created document in knowledge base`,
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
            type: '',
            enabled: true,
            createdAt: '',
            updatedAt: '',
          },
          message: `Failed to create document: ${error.message || 'Unknown error'}`,
          documentId: '',
        },
        error: `Failed to create document: ${error.message || 'Unknown error'}`,
      }
    }
  },
  transformError: async (error): Promise<KnowledgeCreateDocumentResponse> => {
    let errorMessage = 'Failed to create document'

    if (error.message) {
      if (error.message.includes('Document name')) {
        errorMessage = `Document name error: ${error.message}`
      } else if (error.message.includes('Document content')) {
        errorMessage = `Document content error: ${error.message}`
      } else if (error.message.includes('invalid characters')) {
        errorMessage = `${error.message}. Please use a valid filename.`
      } else if (error.message.includes('maximum size')) {
        errorMessage = `${error.message}. Consider breaking large content into smaller documents.`
      } else {
        errorMessage = `Failed to create document: ${error.message}`
      }
    }

    return {
      success: false,
      output: {
        data: {
          id: '',
          name: '',
          type: '',
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
