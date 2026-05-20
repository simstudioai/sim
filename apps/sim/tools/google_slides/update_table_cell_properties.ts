import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  hexToOpaqueColor,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateTableCellPropertiesTool')

interface UpdateTableCellPropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndex: number
  columnIndex: number
  rowSpan: number
  columnSpan: number
  backgroundColor?: string
  backgroundAlpha?: number
  contentAlignment?: 'TOP' | 'MIDDLE' | 'BOTTOM'
  propertiesJson?: string
  fields?: string
}

interface UpdateTableCellPropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateTableCellPropertiesTool: ToolConfig<
  UpdateTableCellPropertiesParams,
  UpdateTableCellPropertiesResponse
> = {
  id: 'google_slides_update_table_cell_properties',
  name: 'Update Table Cell Properties in Google Slides',
  description: 'Update background fill and content alignment for a range of table cells.',
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
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the table',
    },
    rowIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zero-based row index of the top-left cell of the range',
    },
    columnIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zero-based column index of the top-left cell of the range',
    },
    rowSpan: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of rows in the range (minimum 1)',
    },
    columnSpan: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of columns in the range (minimum 1)',
    },
    backgroundColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cell background color as hex (e.g. #F1F3F4)',
    },
    backgroundAlpha: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Background fill opacity between 0.0 and 1.0',
    },
    contentAlignment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vertical alignment of cell content: TOP, MIDDLE, or BOTTOM',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw TableCellProperties JSON merged with the simple fields above',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: explicit FieldMask. If omitted, computed from provided fields.',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) throw new Error('Table object ID is required')

      const props: Record<string, unknown> = {}
      const fieldList: string[] = []

      const bg = hexToOpaqueColor(params.backgroundColor)
      if (bg) {
        props.tableCellBackgroundFill = {
          solidFill: {
            color: bg,
            ...(params.backgroundAlpha !== undefined ? { alpha: params.backgroundAlpha } : {}),
          },
          propertyState: 'RENDERED',
        }
        fieldList.push('tableCellBackgroundFill')
      }
      if (params.contentAlignment) {
        props.contentAlignment = params.contentAlignment
        fieldList.push('contentAlignment')
      }
      if (params.propertiesJson?.trim()) {
        try {
          const extra = JSON.parse(params.propertiesJson)
          if (extra && typeof extra === 'object') Object.assign(props, extra)
        } catch (e) {
          logger.warn('Invalid propertiesJson, ignoring:', { error: e })
        }
      }

      const fields = params.fields?.trim() || (fieldList.length > 0 ? fieldList.join(',') : '*')

      return {
        requests: [
          {
            updateTableCellProperties: {
              objectId,
              tableRange: {
                location: { rowIndex: params.rowIndex, columnIndex: params.columnIndex },
                rowSpan: params.rowSpan,
                columnSpan: params.columnSpan,
              },
              tableCellProperties: props,
              fields,
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
      throw new Error(data.error?.message || 'Failed to update table cell properties')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        updated: true,
        objectId: params?.objectId?.trim() || '',
        fields: params?.fields?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    updated: { type: 'boolean', description: 'Whether the cell properties were updated' },
    objectId: { type: 'string', description: 'The table updated' },
    fields: { type: 'string', description: 'FieldMask applied' },
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
