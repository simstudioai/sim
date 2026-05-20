import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  hexToOpaqueColor,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateVideoPropertiesTool')

interface UpdateVideoPropertiesParams {
  accessToken: string
  presentationId: string
  objectId: string
  autoPlay?: boolean
  mute?: boolean
  start?: number
  end?: number
  outlineColor?: string
  outlineWeight?: number
  outlineDashStyle?: string
  propertiesJson?: string
  fields?: string
}

interface UpdateVideoPropertiesResponse {
  success: boolean
  output: {
    updated: boolean
    objectId: string
    fields: string
    metadata: { presentationId: string; url: string }
  }
}

export const updateVideoPropertiesTool: ToolConfig<
  UpdateVideoPropertiesParams,
  UpdateVideoPropertiesResponse
> = {
  id: 'google_slides_update_video_properties',
  name: 'Update Video Properties in Google Slides',
  description: 'Update video playback options (autoPlay, mute, start/end) and outline.',
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
      description: 'Object ID of the video',
    },
    autoPlay: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Play the video automatically when the slide is shown',
    },
    mute: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mute the video',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Playback start time in seconds',
    },
    end: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Playback end time in seconds',
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
      description: 'Outline dash style',
    },
    propertiesJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Advanced: raw VideoProperties JSON merged with the simple fields above',
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

      if (params.autoPlay !== undefined) {
        props.autoPlay = params.autoPlay
        fieldList.push('autoPlay')
      }
      if (params.mute !== undefined) {
        props.mute = params.mute
        fieldList.push('mute')
      }
      if (params.start !== undefined) {
        props.start = params.start
        fieldList.push('start')
      }
      if (params.end !== undefined) {
        props.end = params.end
        fieldList.push('end')
      }
      const outlineColor = hexToOpaqueColor(params.outlineColor)
      if (outlineColor || params.outlineWeight !== undefined || params.outlineDashStyle) {
        const outline: Record<string, unknown> = { propertyState: 'RENDERED' }
        if (outlineColor) outline.outlineFill = { solidFill: { color: outlineColor } }
        if (params.outlineWeight !== undefined)
          outline.weight = { magnitude: params.outlineWeight, unit: 'PT' }
        if (params.outlineDashStyle) outline.dashStyle = params.outlineDashStyle
        props.outline = outline
        fieldList.push('outline')
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
        requests: [{ updateVideoProperties: { objectId, videoProperties: props, fields } }],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to update video properties')
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
    updated: { type: 'boolean', description: 'Whether the video properties were updated' },
    objectId: { type: 'string', description: 'The video object updated' },
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
