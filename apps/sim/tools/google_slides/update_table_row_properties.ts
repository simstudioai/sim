import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateTableRowPropertiesTool')

interface UpdateTableRowPropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  rowIndices: string
  minRowHeight?: number
  propertiesJson?: string
  fields?: string
}

interface UpdateTableRowPropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateTableRowPropertiesTool: ToolConfig<
  UpdateTableRowPropertiesParams,
  UpdateTableRowPropertiesResponse
> = {
  id: 'google_slides_update_table_row_properties',
  name: 'Update Table Row Properties in Google Slides',
  description: 'Update minimum row heights and other row-level table properties.',
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
    rowIndices: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated zero-based row indices to update (e.g. "0,2,3")',
    },
    minRowHeight: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum row height in points',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw TableRowProperties JSON merged with the simple fields above',
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
      const rowIndices = (params.rowIndices || '')
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 0)
      if (rowIndices.length === 0) throw new Error('At least one row index is required')

      const props: Record<string, unknown> = {}
      const fieldList: string[] = []
      if (params.minRowHeight !== undefined) {
        props.minRowHeight = { magnitude: params.minRowHeight, unit: 'PT' }
        fieldList.push('minRowHeight')
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
            updateTableRowProperties: {
              objectId,
              rowIndices,
              tableRowProperties: props,
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
      throw new Error(data.error?.message || 'Failed to update table row properties')
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
    updated: { type: 'boolean', description: 'Whether the row properties were updated' },
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
