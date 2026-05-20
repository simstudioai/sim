import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  hexToOpaqueColor,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdatePagePropertiesTool')

interface UpdatePagePropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  backgroundColor?: string
  backgroundAlpha?: number
  backgroundImageUrl?: string
  backgroundUnset?: boolean
  propertiesJson?: string
  fields?: string
}

interface UpdatePagePropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updatePagePropertiesTool: ToolConfig<
  UpdatePagePropertiesParams,
  UpdatePagePropertiesResponse
> = {
  id: 'google_slides_update_page_properties',
  name: 'Update Page Properties in Google Slides',
  description:
    'Update slide/page background — solid color or stretched picture — and other page properties.',
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
      description: 'Object ID of the slide/page to update',
    },
    backgroundColor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Solid background color as hex (e.g. #0B1F3A)',
    },
    backgroundAlpha: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Background fill opacity between 0.0 and 1.0',
    },
    backgroundImageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Publicly fetchable image URL to use as a stretched picture background',
    },
    backgroundUnset: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, removes the background so the slide inherits its layout background',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw PageProperties JSON merged with the simple fields above',
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

      if (params.backgroundUnset) {
        props.pageBackgroundFill = { propertyState: 'NOT_RENDERED' }
        fieldList.push('pageBackgroundFill.propertyState')
      } else if (params.backgroundImageUrl?.trim()) {
        props.pageBackgroundFill = {
          stretchedPictureFill: { contentUrl: params.backgroundImageUrl.trim() },
          propertyState: 'RENDERED',
        }
        fieldList.push('pageBackgroundFill')
      } else {
        const bg = hexToOpaqueColor(params.backgroundColor)
        if (bg) {
          props.pageBackgroundFill = {
            solidFill: {
              color: bg,
              ...(params.backgroundAlpha !== undefined ? { alpha: params.backgroundAlpha } : {}),
            },
            propertyState: 'RENDERED',
          }
          fieldList.push('pageBackgroundFill')
        }
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
        requests: [{ updatePageProperties: { objectId, pageProperties: props, fields } }],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to update page properties')
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
    updated: { type: 'boolean', description: 'Whether the page properties were updated' },
    objectId: { type: 'string', description: 'The page object updated' },
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
