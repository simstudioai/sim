import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesDeleteObjectTool')

interface DeleteObjectParams {
  accessToken: string
  presentationId: string
  objectId: string
}

interface DeleteObjectResponse {
  success: boolean
  output: {
    deleted: boolean
    objectId: string
    metadata: {
      presentationId: string
      url: string
    }
  }
}

export const deleteObjectTool: ToolConfig<DeleteObjectParams, DeleteObjectResponse> = {
  id: 'google_slides_delete_object',
  name: 'Delete Object from Google Slides',
  description:
    'Delete a page element (shape, image, table, etc.) or an entire slide from a Google Slides presentation',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

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
      description: 'The object ID of the element or slide to delete',
    },
  },

  request: {
    url: (params) => {
      const presentationId = params.presentationId?.trim()
      if (!presentationId) {
        throw new Error('Presentation ID is required')
      }
      return `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) {
        throw new Error('Object ID is required')
      }

      return {
        requests: [
          {
            deleteObject: {
              objectId,
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
      throw new Error(data.error?.message || 'Failed to delete object')
    }

    const presentationId = params?.presentationId?.trim() || ''
    const objectId = params?.objectId?.trim() || ''

    return {
      success: true,
      output: {
        deleted: true,
        objectId,
        metadata: {
          presentationId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the object was successfully deleted',
    },
    objectId: {
      type: 'string',
      description: 'The object ID that was deleted',
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata including presentation ID and URL',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
