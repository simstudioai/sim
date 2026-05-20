import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesDeleteTableRowTool')

interface DeleteTableRowParams {
  accessToken: string
  presentationId: string
  tableObjectId: string
  rowIndex: number
  columnIndex: number
}

interface DeleteTableRowResponse {
  success: boolean
  output: {
    deleted: boolean
    tableObjectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const deleteTableRowTool: ToolConfig<DeleteTableRowParams, DeleteTableRowResponse> = {
  id: 'google_slides_delete_table_row',
  name: 'Delete Table Row in Google Slides',
  description: 'Delete the row containing the reference cell from a table.',
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
      description: 'Zero-based row index identifying the row to delete',
    },
    columnIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zero-based column index of any cell in the row',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const tableObjectId = params.tableObjectId?.trim()
      if (!tableObjectId) throw new Error('Table object ID is required')

      return {
        requests: [
          {
            deleteTableRow: {
              tableObjectId,
              cellLocation: { rowIndex: params.rowIndex, columnIndex: params.columnIndex },
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
      throw new Error(data.error?.message || 'Failed to delete table row')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        deleted: true,
        tableObjectId: params?.tableObjectId?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the row was deleted' },
    tableObjectId: { type: 'string', description: 'The table updated' },
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
