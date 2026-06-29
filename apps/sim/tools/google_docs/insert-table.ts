import type { GoogleDocsInsertTableResponse, GoogleDocsToolParams } from '@/tools/google_docs/types'
import {
  buildBatchUpdateMetadata,
  buildInsertLocation,
  resolveDocumentId,
} from '@/tools/google_docs/utils'
import type { ToolConfig } from '@/tools/types'

export const insertTableTool: ToolConfig<GoogleDocsToolParams, GoogleDocsInsertTableResponse> = {
  id: 'google_docs_insert_table',
  name: 'Insert Table into Google Docs Document',
  description:
    'Insert an empty table with the given number of rows and columns into a Google Docs document. When no index is provided, the table is appended to the end of the document.',
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
      description: 'The ID of the document to insert the table into',
    },
    rows: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The number of rows in the table',
    },
    columns: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The number of columns in the table',
    },
    index: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The 1-based character index at which to insert the table. When omitted, the table is appended to the end of the document.',
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
      const rows = Number(params.rows)
      const columns = Number(params.columns)
      if (!Number.isFinite(rows) || rows < 1) {
        throw new Error('Rows must be a positive number')
      }
      if (!Number.isFinite(columns) || columns < 1) {
        throw new Error('Columns must be a positive number')
      }
      return {
        requests: [
          {
            insertTable: {
              ...buildInsertLocation(params.index),
              rows,
              columns,
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
      description: 'Indicates if the table was inserted successfully',
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
