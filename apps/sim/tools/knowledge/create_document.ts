import type { KnowledgeCreateDocumentResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

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
    tag1: {
      type: 'string',
      required: false,
      description: 'Tag 1 value for the document',
    },
    tag2: {
      type: 'string',
      required: false,
      description: 'Tag 2 value for the document',
    },
    tag3: {
      type: 'string',
      required: false,
      description: 'Tag 3 value for the document',
    },
    tag4: {
      type: 'string',
      required: false,
      description: 'Tag 4 value for the document',
    },
    tag5: {
      type: 'string',
      required: false,
      description: 'Tag 5 value for the document',
    },
    tag6: {
      type: 'string',
      required: false,
      description: 'Tag 6 value for the document',
    },
    tag7: {
      type: 'string',
      required: false,
      description: 'Tag 7 value for the document',
    },
    documentTagsData: {
      type: 'array',
      required: false,
      description: 'Structured tag data with names, types, and values',
    },
  },

  request: {
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/documents`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const workflowId = params._context?.workflowId
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
      if (!textContent || textContent.length < 1) {
        throw new Error('Document content cannot be empty')
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

      const tagData: Record<string, string> = {}

      if (params.documentTags) {
        let parsedTags = params.documentTags

        // Handle both string (JSON) and array formats
        if (typeof params.documentTags === 'string') {
          try {
            parsedTags = JSON.parse(params.documentTags)
          } catch (error) {
            parsedTags = []
          }
        }

        if (Array.isArray(parsedTags)) {
          tagData.documentTagsData = JSON.stringify(parsedTags)
        }
      }

      const documents = [
        {
          filename: documentName.endsWith('.txt') ? documentName : `${documentName}.txt`,
          fileUrl: dataUri,
          fileSize: contentBytes,
          mimeType: 'text/plain',
          ...tagData,
        },
      ]

      const requestBody = {
        documents: documents,
        processingOptions: {
          chunkSize: 1024,
          minCharactersPerChunk: 1,
          chunkOverlap: 200,
          recipe: 'default',
          lang: 'en',
        },
        bulk: true,
        ...(workflowId && { workflowId }),
      }

      return requestBody
    },
  },

  transformResponse: async (response): Promise<KnowledgeCreateDocumentResponse> => {
    const result = await response.json()
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
          name: uploadCount > 1 ? `${uploadCount} documents` : firstDocument?.filename || 'Unknown',
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
  },

  outputs: {
    data: {
      type: 'object',
      description: 'Information about the created document',
      properties: {
        id: { type: 'string', description: 'Document ID' },
        name: { type: 'string', description: 'Document name' },
        type: { type: 'string', description: 'Document type' },
        enabled: { type: 'boolean', description: 'Whether the document is enabled' },
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
      description: 'ID of the created document',
    },
  },
}
