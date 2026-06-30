import type {
  GoogleDocsInsertPageBreakResponse,
  GoogleDocsToolParams,
} from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildInsertLocation,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const insertPageBreakTool: ToolConfig<
  GoogleDocsToolParams,
  GoogleDocsInsertPageBreakResponse
> = {
  id: 'google_docs_insert_page_break',
  name: 'Insert Page Break into Google Docs Document',
  description:
    'Insert a page break into a Google Docs document. When no index is provided, the page break is appended to the end of the document.',
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
      description: 'The ID of the document to insert the page break into',
    },
    index: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The zero-based character index at which to insert the page break. When omitted, the page break is appended to the end of the document.',
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
      return {
        requests: [
          {
            insertPageBreak: {
              ...buildInsertLocation(params.index),
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
      description: 'Indicates if the page break was inserted successfully',
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
