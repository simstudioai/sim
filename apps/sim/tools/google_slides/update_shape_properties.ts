import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  hexToOpaqueColor,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateShapePropertiesTool')

interface UpdateShapePropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  fillColor?: string
  fillAlpha?: number
  fillUnset?: boolean
  outlineColor?: string
  outlineWeight?: number
  outlineDashStyle?: string
  outlineUnset?: boolean
  linkUrl?: string
  contentAlignment?: 'TOP' | 'MIDDLE' | 'BOTTOM'
  autofitType?: 'NONE' | 'TEXT_AUTOFIT' | 'SHAPE_AUTOFIT'
  propertiesJson?: string
  fields?: string
}

interface UpdateShapePropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateShapePropertiesTool: ToolConfig<
  UpdateShapePropertiesParams,
  UpdateShapePropertiesResponse
> = {
  id: 'google_slides_update_shape_properties',
  name: 'Update Shape Properties in Google Slides',
  description:
    "Update a shape's appearance — background fill color, outline, link, content alignment, autofit. Pass only the properties you want to change.",
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
      description: 'Object ID of the shape to update',
    },
    fillColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Solid background fill color as hex (e.g. #FF6F61)',
    },
    fillAlpha: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fill opacity between 0.0 (transparent) and 1.0 (opaque)',
    },
    fillUnset: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, removes any fill so the shape inherits its layout/master fill',
    },
    outlineColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Outline color as hex',
    },
    outlineWeight: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Outline weight in points',
    },
    outlineDashStyle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Outline dash style: SOLID, DOT, DASH, DASH_DOT, LONG_DASH, LONG_DASH_DOT',
    },
    outlineUnset: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, removes any outline so the shape inherits its layout/master outline',
    },
    linkUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Make the shape a hyperlink to this URL',
    },
    contentAlignment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Vertical alignment of shape contents: TOP, MIDDLE, or BOTTOM',
    },
    autofitType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Autofit behavior: NONE, TEXT_AUTOFIT, or SHAPE_AUTOFIT',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw ShapeProperties JSON merged with the simple fields above',
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

      const fill = hexToOpaqueColor(params.fillColor)
      if (params.fillUnset) {
        props.shapeBackgroundFill = { propertyState: 'NOT_RENDERED' }
        fieldList.push('shapeBackgroundFill.propertyState')
      } else if (fill) {
        props.shapeBackgroundFill = {
          solidFill: {
            color: fill,
            ...(params.fillAlpha !== undefined ? { alpha: params.fillAlpha } : {}),
          },
          propertyState: 'RENDERED',
        }
        fieldList.push('shapeBackgroundFill')
      }

      const outlineColor = hexToOpaqueColor(params.outlineColor)
      if (params.outlineUnset) {
        props.outline = { propertyState: 'NOT_RENDERED' }
        fieldList.push('outline.propertyState')
      } else if (outlineColor || params.outlineWeight !== undefined || params.outlineDashStyle) {
        const outline: Record<string, unknown> = { propertyState: 'RENDERED' }
        if (outlineColor) outline.outlineFill = { solidFill: { color: outlineColor } }
        if (params.outlineWeight !== undefined)
          outline.weight = { magnitude: params.outlineWeight, unit: 'PT' }
        if (params.outlineDashStyle) outline.dashStyle = params.outlineDashStyle
        props.outline = outline
        fieldList.push('outline')
      }

      if (params.linkUrl) {
        props.link = { url: params.linkUrl }
        fieldList.push('link')
      }
      if (params.contentAlignment) {
        props.contentAlignment = params.contentAlignment
        fieldList.push('contentAlignment')
      }
      if (params.autofitType) {
        props.autofit = { autofitType: params.autofitType }
        fieldList.push('autofit.autofitType')
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
        requests: [{ updateShapeProperties: { objectId, shapeProperties: props, fields } }],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to update shape properties')
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
    updated: { type: 'boolean', description: 'Whether the shape properties were updated' },
    objectId: { type: 'string', description: 'The shape object updated' },
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
