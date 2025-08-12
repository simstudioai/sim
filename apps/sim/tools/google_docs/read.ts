import type { GoogleDocsReadResponse, GoogleDocsToolParams } from '@/tools/google_docs/types'
import { extractTextFromDocument } from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const readTool: ToolConfig<GoogleDocsToolParams, GoogleDocsReadResponse> = {
  id: 'google_docs_read',
  name: 'Read Google Docs Document',
  description: 'Read content from a Google Docs document',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-docs',
    additionalScopes: ['https://www.googleapis.com/auth/drive.file'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Docs API',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the document to read',
    },
  },

  request: {
    url: (params) => {
      // Ensure documentId is valid
      const documentId = params.documentId?.trim() || params.manualDocumentId?.trim()
      if (!documentId) {
        throw new Error('Document ID is required')
      }

      return `https://docs.googleapis.com/v1/documents/${documentId}`
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Extract document content from the response
    let content = ''
    if (data.body?.content) {
      content = extractTextFromDocument(data)
    }

    // Create document metadata
    const metadata = {
      documentId: data.documentId,
      title: data.title || 'Untitled Document',
      mimeType: 'application/vnd.google-apps.document',
      url: `https://docs.google.com/document/d/${data.documentId}/edit`,
    }

    return {
      success: true,
      output: {
        content,
        metadata,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Extracted document text content' },
    metadata: { type: 'json', description: 'Document metadata including ID, title, and URL' },
  },
}
