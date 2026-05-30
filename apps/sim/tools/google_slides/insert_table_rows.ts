import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesInsertTableRowsTool')

interface InsertTableRowsParams {
  accessToken: string
  presentationId: string
  tableObjectId: string
  rowIndex: number
  columnIndex: number
  number: number
  insertBelow?: boolean
}

interface InsertTableRowsResponse {
  success: boolean
  output: {
    inserted: boolean
    tableObjectId: string
    number: number
    metadata: { presentationId: string; url: string }
  }
}

export const insertTableRowsTool: ToolConfig<InsertTableRowsParams, InsertTableRowsResponse> = {
  id: 'google_slides_insert_table_rows',
  name: 'Insert Table Rows in Google Slides',
  description: 'Insert one or more rows into a table, above or below a reference cell.',
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides API',
    },
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    tableObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the table',
    },
    rowIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zero-based row index of the reference cell',
    },
    columnIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zero-based column index of the reference cell',
    },
    number: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of rows to insert (minimum 1)',
    },
    insertBelow: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Insert below the reference row instead of above (default false)',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const tableObjectId = params.tableObjectId?.trim()
      if (!tableObjectId) throw new Error('Table object ID is required')
      const number = params.number
      if (!number || number < 1) throw new Error('Number of rows must be at least 1')

      return {
        requests: [
          {
            insertTableRows: {
              tableObjectId,
              cellLocation: { rowIndex: params.rowIndex, columnIndex: params.columnIndex },
              insertBelow: params.insertBelow ?? false,
              number,
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to insert table rows')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        inserted: true,
        tableObjectId: params?.tableObjectId?.trim() || '',
        number: params?.number ?? 0,
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    inserted: { type: 'boolean', description: 'Whether rows were inserted' },
    tableObjectId: { type: 'string', description: 'The table updated' },
    number: { type: 'number', description: 'Number of rows inserted' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
