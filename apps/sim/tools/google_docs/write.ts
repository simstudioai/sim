import type { GoogleDocsToolParams, GoogleDocsWriteResponse } from '@/tools/google_docs/types'
import type { ToolConfig } from '@/tools/types'

export const writeTool: ToolConfig<GoogleDocsToolParams, GoogleDocsWriteResponse> = {
  id: 'google_docs_write',
  name: 'Write to Google Docs Document',
  description: 'Write or update content in a Google Docs document',
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
      description: 'The ID of the document to write to',
    },
    content: {
      type: 'string',
      required: true,
      description: 'The content to write to the document',
    },
  },
  request: {
    url: (params) => {
      // Ensure documentId is valid
      const documentId = params.documentId?.trim() || params.manualDocumentId?.trim()
      if (!documentId) {
        throw new Error('Document ID is required')
      }

      return `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`
    },
    method: 'POST',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      // Validate content
      if (!params.content) {
        throw new Error('Content is required')
      }

      // Following the exact format from the Google Docs API examples
      // Always insert at the end of the document to avoid duplication
      // See: https://developers.google.com/docs/api/reference/rest/v1/documents/request#InsertTextRequest
      const requestBody = {
        requests: [
          {
            insertText: {
              endOfSegmentLocation: {},
              text: params.content,
            },
          },
        ],
      }

      return requestBody
    },
  },

  outputs: {
    updatedContent: {
      type: 'boolean',
      description: 'Indicates if document content was updated successfully',
    },
    metadata: {
      type: 'json',
      description: 'Updated document metadata including ID, title, and URL',
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    // Parse the response if it's not empty
    let _data = {}
    if (responseText.trim()) {
      _data = JSON.parse(responseText)
    }

    // Get the document ID from the URL
    const urlParts = response.url.split('/')
    let documentId = ''
    for (let i = 0; i < urlParts.length; i++) {
      if (urlParts[i] === 'documents' && i + 1 < urlParts.length) {
        documentId = urlParts[i + 1].split(':')[0]
        break
      }
    }

    // Create document metadata
    const metadata = {
      documentId,
      title: 'Updated Document',
      mimeType: 'application/vnd.google-apps.document',
      url: `https://docs.google.com/document/d/${documentId}/edit`,
    }

    return {
      success: true,
      output: {
        updatedContent: true,
        metadata,
      },
    }
  },
}
