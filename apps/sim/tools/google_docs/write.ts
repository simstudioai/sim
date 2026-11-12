import type { GoogleDocsToolParams, GoogleDocsWriteResponse } from '@/tools/google_docs/types'
import { resolveDocumentId, resolveTabId } from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const writeTool: ToolConfig<GoogleDocsToolParams, GoogleDocsWriteResponse> = {
  id: 'google_docs_write',
  name: 'Write to Google Docs Document',
  description:
    'Append content to a Google Docs document. Content is inserted literally; Markdown is not interpreted. For formatted output from Markdown, use the Create operation with the markdown toggle enabled.',
  version: '1.0',
  assistant: {
    effect: 'write',
    version: 1,
    reviewFields: [
      { name: 'documentId', label: 'Document', target: true },
      { name: 'content', label: 'Content', format: 'multiline', editable: true },
    ],
  },
  oauth: {
    required: true,
    provider: 'google-docs',
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
      visibility: 'user-or-llm',
      description: 'The ID of the document to write to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content to write to the document',
    },
    tabId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the tab to append the content to (from Read with includeTabsContent). When omitted, the first tab is used.',
    },
  },
  request: {
    url: (params) => {
      const documentId = resolveDocumentId(params)
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

      const tabId = resolveTabId(params.tabId)
      const requestBody = {
        requests: [
          {
            insertText: {
              endOfSegmentLocation: tabId ? { tabId } : {},
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
      properties: {
        documentId: { type: 'string', description: 'Google Docs document ID' },
        title: { type: 'string', description: 'Document title' },
        mimeType: { type: 'string', description: 'Document MIME type' },
        url: { type: 'string', description: 'Document URL' },
      },
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
