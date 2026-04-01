import {
  inferDocumentFileInfo,
  type KnowledgeCreateDocumentResponse,
} from '@/tools/knowledge/types'
import { enrichKBTagsSchema } from '@/tools/schema-enrichers'
import { formatDocumentTagsForAPI, parseDocumentTags } from '@/tools/shared/tags'
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
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base containing the document',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the document',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content of the document',
    },
    documentTags: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document tags',
    },
  },

  schemaEnrichment: {
    documentTags: {
      dependsOn: 'knowledgeBaseId',
      enrichSchema: enrichKBTagsSchema,
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
      if (!textContent || textContent.length < 1) {
        throw new Error('Document content cannot be empty')
      }
      const utf8Bytes = new TextEncoder().encode(textContent)
      const contentBytes = utf8Bytes.length

      if (contentBytes > 1_000_000) {
        throw new Error('Document content exceeds maximum size of 1MB')
      }

      let base64Content: string
      if (typeof Buffer !== 'undefined') {
        base64Content = Buffer.from(textContent, 'utf8').toString('base64')
      } else {
        let binary = ''
        for (let i = 0; i < utf8Bytes.length; i++) {
          binary += String.fromCharCode(utf8Bytes[i])
        }
        base64Content = btoa(binary)
      }

      const { filename, mimeType } = inferDocumentFileInfo(documentName)
      const dataUri = `data:${mimeType};base64,${base64Content}`

      const parsedTags = parseDocumentTags(params.documentTags)
      const tagData = formatDocumentTagsForAPI(parsedTags)

      const documents = [
        {
          filename,
          fileUrl: dataUri,
          fileSize: contentBytes,
          mimeType,
          ...tagData,
        },
      ]

      const requestBody = {
        documents: documents,
        processingOptions: {
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
        message:
          uploadCount > 1
            ? `Successfully created ${uploadCount} documents in knowledge base`
            : `Successfully created document in knowledge base`,
        data: {
          documentId: firstDocument?.documentId || firstDocument?.id || '',
          documentName:
            uploadCount > 1 ? `${uploadCount} documents` : firstDocument?.filename || 'Unknown',
          type: 'document',
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }
  },

  outputs: {
    data: {
      type: 'object',
      description: 'Information about the created document',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        documentName: { type: 'string', description: 'Document name' },
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
