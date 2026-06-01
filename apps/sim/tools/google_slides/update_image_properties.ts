import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  hexToOpaqueColor,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateImagePropertiesTool')

interface UpdateImagePropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  brightness?: number
  contrast?: number
  transparency?: number
  linkUrl?: string
  outlineColor?: string
  outlineWeight?: number
  outlineDashStyle?: string
  cropLeftOffset?: number
  cropRightOffset?: number
  cropTopOffset?: number
  cropBottomOffset?: number
  cropAngle?: number
  propertiesJson?: string
  fields?: string
}

interface UpdateImagePropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateImagePropertiesTool: ToolConfig<
  UpdateImagePropertiesParams,
  UpdateImagePropertiesResponse
> = {
  id: 'google_slides_update_image_properties',
  name: 'Update Image Properties in Google Slides',
  description:
    'Update image properties — brightness, contrast, transparency, crop, outline, link — on an existing image.',
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
      description: 'Object ID of the image to update',
    },
    brightness: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Brightness adjustment between -1.0 and 1.0',
    },
    contrast: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Contrast adjustment between -1.0 and 1.0',
    },
    transparency: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transparency between 0.0 (opaque) and 1.0 (fully transparent)',
    },
    linkUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Make the image a hyperlink to this URL',
    },
    outlineColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Outline color as hex (e.g. #1A73E8)',
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
    cropLeftOffset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Crop offset from left edge (0.0 to 1.0)',
    },
    cropRightOffset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Crop offset from right edge (0.0 to 1.0)',
    },
    cropTopOffset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Crop offset from top edge (0.0 to 1.0)',
    },
    cropBottomOffset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Crop offset from bottom edge (0.0 to 1.0)',
    },
    cropAngle: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Crop rotation angle in radians (clockwise)',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw ImageProperties JSON merged with the simple fields above',
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

      if (params.brightness !== undefined) {
        props.brightness = params.brightness
        fieldList.push('brightness')
      }
      if (params.contrast !== undefined) {
        props.contrast = params.contrast
        fieldList.push('contrast')
      }
      if (params.transparency !== undefined) {
        props.transparency = params.transparency
        fieldList.push('transparency')
      }
      if (params.linkUrl) {
        props.link = { url: params.linkUrl }
        fieldList.push('link')
      }
      const outline: Record<string, unknown> = {}
      const outlineColor = hexToOpaqueColor(params.outlineColor)
      if (outlineColor) {
        outline.outlineFill = { solidFill: { color: outlineColor } }
      }
      if (params.outlineWeight !== undefined) {
        outline.weight = { magnitude: params.outlineWeight, unit: 'PT' }
      }
      if (params.outlineDashStyle) {
        outline.dashStyle = params.outlineDashStyle
      }
      if (Object.keys(outline).length > 0) {
        props.outline = outline
        fieldList.push('outline')
      }

      const crop: Record<string, unknown> = {}
      if (params.cropLeftOffset !== undefined) crop.leftOffset = params.cropLeftOffset
      if (params.cropRightOffset !== undefined) crop.rightOffset = params.cropRightOffset
      if (params.cropTopOffset !== undefined) crop.topOffset = params.cropTopOffset
      if (params.cropBottomOffset !== undefined) crop.bottomOffset = params.cropBottomOffset
      if (params.cropAngle !== undefined) crop.angle = params.cropAngle
      if (Object.keys(crop).length > 0) {
        props.cropProperties = crop
        fieldList.push('cropProperties')
      }

      if (params.propertiesJson?.trim()) {
        try {
          const extra = JSON.parse(params.propertiesJson)
          if (extra && typeof extra === 'object') {
            Object.assign(props, extra)
          }
        } catch (e) {
          logger.warn('Invalid propertiesJson, ignoring:', { error: e })
        }
      }

      const fields = params.fields?.trim() || (fieldList.length > 0 ? fieldList.join(',') : '*')

      return {
        requests: [
          {
            updateImageProperties: { objectId, imageProperties: props, fields },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to update image properties')
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
    updated: { type: 'boolean', description: 'Whether the image properties were updated' },
    objectId: { type: 'string', description: 'The image object updated' },
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
