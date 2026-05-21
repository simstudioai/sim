import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateTableColumnPropertiesTool')

interface UpdateTableColumnPropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  columnIndices: string
  columnWidth?: number
  propertiesJson?: string
  fields?: string
}

interface UpdateTableColumnPropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateTableColumnPropertiesTool: ToolConfig<
  UpdateTableColumnPropertiesParams,
  UpdateTableColumnPropertiesResponse
> = {
  id: 'google_slides_update_table_column_properties',
  name: 'Update Table Column Properties in Google Slides',
  description: 'Update column widths and other column-level table properties.',
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
    columnIndices: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated zero-based column indices to update (e.g. "0,2,3")',
    },
    columnWidth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Column width in points',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw TableColumnProperties JSON merged with the simple fields above',
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
      const columnIndices = (params.columnIndices || '')
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 0)
      if (columnIndices.length === 0) throw new Error('At least one column index is required')

      const props: Record<string, unknown> = {}
      const fieldList: string[] = []
      if (params.columnWidth !== undefined) {
        props.columnWidth = { magnitude: params.columnWidth, unit: 'PT' }
        fieldList.push('columnWidth')
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
            updateTableColumnProperties: {
              objectId,
              columnIndices,
              tableColumnProperties: props,
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
      throw new Error(data.error?.message || 'Failed to update table column properties')
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
    updated: { type: 'boolean', description: 'Whether the column properties were updated' },
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
