import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  generateObjectId,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesGroupObjectsTool')

interface GroupObjectsParams {
  accessToken: string
  presentationId: string
  childrenObjectIds: string
  groupObjectId?: string
}

interface GroupObjectsResponse {
  success: boolean
  output: {
    grouped: boolean
    groupObjectId: string
    childrenObjectIds: string[]
    metadata: { presentationId: string; url: string }
  }
}

export const groupObjectsTool: ToolConfig<GroupObjectsParams, GroupObjectsResponse> = {
  id: 'google_slides_group_objects',
  name: 'Group Objects in Google Slides',
  description: 'Group two or more page elements on the same slide into a single object group.',
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
    childrenObjectIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated object IDs of the elements to group (must be on the same slide)',
    },
    groupObjectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional object ID to assign to the new group',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const children = (params.childrenObjectIds || '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
      if (children.length < 2) throw new Error('At least two child object IDs are required')

      const groupObjectId = params.groupObjectId?.trim() || generateObjectId('group')

      return {
        requests: [
          {
            groupObjects: {
              groupObjectId,
              childrenObjectIds: children,
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
      throw new Error(data.error?.message || 'Failed to group objects')
    }
    const groupObjectId = data.replies?.[0]?.groupObjects?.objectId ?? params?.groupObjectId ?? ''
    const presentationId = params?.presentationId?.trim() || ''
    const children = (params?.childrenObjectIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    return {
      success: true,
      output: {
        grouped: true,
        groupObjectId,
        childrenObjectIds: children,
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    grouped: { type: 'boolean', description: 'Whether the objects were grouped' },
    groupObjectId: { type: 'string', description: 'Object ID of the new group' },
    childrenObjectIds: {
      type: 'array',
      description: 'IDs of the grouped children',
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
