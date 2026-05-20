import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUngroupObjectsTool')

interface UngroupObjectsParams {
  accessToken: string
  presentationId: string
  objectIds: string
}

interface UngroupObjectsResponse {
  success: boolean
  output: {
    ungrouped: boolean
    objectIds: string[]
    metadata: { presentationId: string; url: string }
  }
}

export const ungroupObjectsTool: ToolConfig<UngroupObjectsParams, UngroupObjectsResponse> = {
  id: 'google_slides_ungroup_objects',
  name: 'Ungroup Objects in Google Slides',
  description: 'Ungroup one or more object groups, releasing their children back to the slide.',
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
    objectIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated object IDs of the groups to ungroup',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectIds = (params.objectIds || '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
      if (objectIds.length === 0) throw new Error('At least one group object ID is required')

      return { requests: [{ ungroupObjects: { objectIds } }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to ungroup objects')
    }
    const presentationId = params?.presentationId?.trim() || ''
    const objectIds = (params?.objectIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    return {
      success: true,
      output: {
        ungrouped: true,
        objectIds,
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    ungrouped: { type: 'boolean', description: 'Whether the objects were ungrouped' },
    objectIds: {
      type: 'array',
      description: 'Group IDs that were ungrouped',
      items: { type: 'string' },
    },
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
