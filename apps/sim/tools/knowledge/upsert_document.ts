import {
  inferDocumentFileInfo,
  type KnowledgeUpsertDocumentParams,
  type KnowledgeUpsertDocumentResponse,
} from '@/tools/knowledge/types'
import { enrichKBTagsSchema } from '@/tools/schema-enrichers'
import { formatDocumentTagsForAPI, parseDocumentTags } from '@/tools/shared/tags'
import type { ToolConfig } from '@/tools/types'

export const knowledgeUpsertDocumentTool: ToolConfig<
  KnowledgeUpsertDocumentParams,
  KnowledgeUpsertDocumentResponse
> = {
  id: 'knowledge_upsert_document',
  name: 'Knowledge Upsert Document',
  description:
    'Create or update a document in a knowledge base. If a document with the given ID or filename already exists, it will be replaced with the new content.',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional ID of an existing document to update. If not provided, lookup is done by filename.',
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
      type: 'json',
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
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/documents/upsert`,
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

      const requestBody: Record<string, unknown> = {
        filename,
        fileUrl: dataUri,
        fileSize: contentBytes,
        mimeType,
        ...tagData,
        processingOptions: {
          chunkSize: 1024,
          minCharactersPerChunk: 1,
          chunkOverlap: 200,
          recipe: 'default',
          lang: 'en',
        },
        ...(workflowId && { workflowId }),
      }

      if (params.documentId && String(params.documentId).trim().length > 0) {
        requestBody.documentId = String(params.documentId).trim()
      }

      return requestBody
    },
  },

  transformResponse: async (response): Promise<KnowledgeUpsertDocumentResponse> => {
    const result = await response.json()
    const data = result.data ?? result
    const documentsCreated = data.documentsCreated ?? []
    const firstDocument = documentsCreated[0]
    const isUpdate = data.isUpdate ?? false
    const previousDocumentId = data.previousDocumentId ?? null
    const documentId = firstDocument?.documentId ?? firstDocument?.id ?? ''

    return {
      success: true,
      output: {
        message: isUpdate
          ? 'Successfully updated document in knowledge base'
          : 'Successfully created document in knowledge base',
        documentId,
        data: {
          documentId,
          documentName: firstDocument?.filename ?? 'Unknown',
          type: 'document',
          enabled: true,
          isUpdate,
          previousDocumentId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }
  },

  outputs: {
    data: {
      type: 'object',
      description: 'Information about the upserted document',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        documentName: { type: 'string', description: 'Document name' },
        type: { type: 'string', description: 'Document type' },
        enabled: { type: 'boolean', description: 'Whether the document is enabled' },
        isUpdate: {
          type: 'boolean',
          description: 'Whether an existing document was replaced',
        },
        previousDocumentId: {
          type: 'string',
          description: 'ID of the document that was replaced, if any',
          optional: true,
        },
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
      description: 'ID of the upserted document',
    },
  },
}
