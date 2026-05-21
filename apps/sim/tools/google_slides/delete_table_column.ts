import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesDeleteTableColumnTool')

interface DeleteTableColumnParams {
  accessToken: string
  presentationId: string
  tableObjectId: string
  rowIndex: number
  columnIndex: number
}

interface DeleteTableColumnResponse {
  success: boolean
  output: {
    deleted: boolean
    tableObjectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const deleteTableColumnTool: ToolConfig<DeleteTableColumnParams, DeleteTableColumnResponse> =
  {
    id: 'google_slides_delete_table_column',
    name: 'Delete Table Column in Google Slides',
    description: 'Delete the column containing the reference cell from a table.',
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
        description: 'Zero-based row index of any cell in the column',
      },
      columnIndex: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Zero-based column index identifying the column to delete',
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
              deleteTableColumn: {
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
        throw new Error(data.error?.message || 'Failed to delete table column')
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
      deleted: { type: 'boolean', description: 'Whether the column was deleted' },
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
