import type { GoogleDocsInsertTextResponse, GoogleDocsToolParams } from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildInsertLocation,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const insertTextTool: ToolConfig<GoogleDocsToolParams, GoogleDocsInsertTextResponse> = {
  id: 'google_docs_insert_text',
  name: 'Insert Text into Google Docs Document',
  description:
    'Insert text at a specific index in a Google Docs document. When no index is provided, text is appended to the end of the document. Text is inserted literally; Markdown is not interpreted.',
  version: '1.0',
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
      description: 'The ID of the document to insert text into',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to insert',
    },
    index: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The 1-based character index at which to insert the text. When omitted, text is appended to the end of the document.',
    },
  },
  request: {
    url: (params) => {
      const documentId = resolveDocumentId(params)
      return `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      if (!params.text) {
        throw new Error('Text is required')
      }
      return {
        requests: [
          {
            insertText: {
              ...buildInsertLocation(params.index),
              text: params.text,
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const data = responseText.trim() ? JSON.parse(responseText) : {}
    const metadata = buildBatchUpdateMetadata(data, response.url)

    return {
      success: true,
      output: {
        updatedContent: true,
        metadata,
      },
    }
  },

  outputs: {
    updatedContent: {
      type: 'boolean',
      description: 'Indicates if text was inserted successfully',
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
}
