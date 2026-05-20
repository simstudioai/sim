import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  hexToOpaqueColor,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateTableBorderPropertiesTool')

interface UpdateTableBorderPropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndex: number
  columnIndex: number
  rowSpan: number
  columnSpan: number
  borderPosition?:
    | 'ALL'
    | 'BOTTOM'
    | 'INNER'
    | 'INNER_HORIZONTAL'
    | 'INNER_VERTICAL'
    | 'LEFT'
    | 'OUTER'
    | 'RIGHT'
    | 'TOP'
  borderColor?: string
  borderWeight?: number
  dashStyle?: string
  propertiesJson?: string
  fields?: string
}

interface UpdateTableBorderPropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateTableBorderPropertiesTool: ToolConfig<
  UpdateTableBorderPropertiesParams,
  UpdateTableBorderPropertiesResponse
> = {
  id: 'google_slides_update_table_border_properties',
  name: 'Update Table Border Properties in Google Slides',
  description:
    'Update border color, weight, and dash style for a position (e.g. ALL, INNER, OUTER) in a table range.',
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
    borderPosition: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Which borders to update: ALL (default), BOTTOM, INNER, INNER_HORIZONTAL, INNER_VERTICAL, LEFT, OUTER, RIGHT, TOP',
    },
    borderColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Border color as hex',
    },
    borderWeight: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Border weight in points',
    },
    dashStyle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dash style: SOLID, DOT, DASH, DASH_DOT, LONG_DASH, LONG_DASH_DOT',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw TableBorderProperties JSON merged with the simple fields above',
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

      const color = hexToOpaqueColor(params.borderColor)
      if (color) {
        props.tableBorderFill = { solidFill: { color } }
        fieldList.push('tableBorderFill')
      }
      if (params.borderWeight !== undefined) {
        props.weight = { magnitude: params.borderWeight, unit: 'PT' }
        fieldList.push('weight')
      }
      if (params.dashStyle) {
        props.dashStyle = params.dashStyle
        fieldList.push('dashStyle')
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
            updateTableBorderProperties: {
              objectId,
              tableRange: {
                location: { rowIndex: params.rowIndex, columnIndex: params.columnIndex },
                rowSpan: params.rowSpan,
                columnSpan: params.columnSpan,
              },
              borderPosition: params.borderPosition || 'ALL',
              tableBorderProperties: props,
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
      throw new Error(data.error?.message || 'Failed to update table border properties')
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
    updated: { type: 'boolean', description: 'Whether the border properties were updated' },
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
