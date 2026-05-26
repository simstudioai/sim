import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  hexToOpaqueColor,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateLinePropertiesTool')

interface UpdateLinePropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  lineColor?: string
  lineWeight?: number
  dashStyle?: string
  startArrow?: string
  endArrow?: string
  linkUrl?: string
  propertiesJson?: string
  fields?: string
}

interface UpdateLinePropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateLinePropertiesTool: ToolConfig<
  UpdateLinePropertiesParams,
  UpdateLinePropertiesResponse
> = {
  id: 'google_slides_update_line_properties',
  name: 'Update Line Properties in Google Slides',
  description: 'Update line appearance — color, weight, dash style, arrows, link.',
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
      description: 'Object ID of the line',
    },
    lineColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line color as hex',
    },
    lineWeight: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Line weight in points',
    },
    dashStyle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dash style: SOLID, DOT, DASH, DASH_DOT, LONG_DASH, LONG_DASH_DOT',
    },
    startArrow: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start arrow style: NONE, STEALTH_ARROW, FILL_ARROW, FILL_CIRCLE, FILL_SQUARE, FILL_DIAMOND, OPEN_ARROW, OPEN_CIRCLE, OPEN_SQUARE, OPEN_DIAMOND',
    },
    endArrow: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End arrow style (same values as startArrow)',
    },
    linkUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hyperlink URL',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw LineProperties JSON merged with the simple fields above',
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
      if (!objectId) throw new Error('Object ID is required')

      const props: Record<string, unknown> = {}
      const fieldList: string[] = []

      const color = hexToOpaqueColor(params.lineColor)
      if (color) {
        props.lineFill = { solidFill: { color } }
        fieldList.push('lineFill')
      }
      if (params.lineWeight !== undefined) {
        props.weight = { magnitude: params.lineWeight, unit: 'PT' }
        fieldList.push('weight')
      }
      if (params.dashStyle) {
        props.dashStyle = params.dashStyle
        fieldList.push('dashStyle')
      }
      if (params.startArrow) {
        props.startArrow = params.startArrow
        fieldList.push('startArrow')
      }
      if (params.endArrow) {
        props.endArrow = params.endArrow
        fieldList.push('endArrow')
      }
      if (params.linkUrl) {
        props.link = { url: params.linkUrl }
        fieldList.push('link')
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
        requests: [{ updateLineProperties: { objectId, lineProperties: props, fields } }],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to update line properties')
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
    updated: { type: 'boolean', description: 'Whether the line properties were updated' },
    objectId: { type: 'string', description: 'The line object updated' },
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
