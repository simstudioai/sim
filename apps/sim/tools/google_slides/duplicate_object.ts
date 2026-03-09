import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesDuplicateObjectTool')

interface DuplicateObjectParams {
  accessToken: string
  presentationId: string
  objectId: string
  objectIds?: string
}

interface DuplicateObjectResponse {
  success: boolean
  output: {
    duplicatedObjectId: string
    metadata: {
      presentationId: string
      sourceObjectId: string
      url: string
    }
  }
}

export const duplicateObjectTool: ToolConfig<DuplicateObjectParams, DuplicateObjectResponse> = {
  id: 'google_slides_duplicate_object',
  name: 'Duplicate Object in Google Slides',
  description:
    'Duplicate an object (slide, shape, image, table, etc.) in a Google Slides presentation',
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
      description: 'The object ID of the element or slide to duplicate',
    },
    objectIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional JSON object mapping source object IDs (within the slide being duplicated) to new object IDs for the duplicates. Format: {"sourceId1":"newId1","sourceId2":"newId2"}',
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

      const duplicateRequest: Record<string, any> = {
        objectId,
      }

      // Parse objectIds mapping if provided
      if (params.objectIds?.trim()) {
        try {
          const mapping = JSON.parse(params.objectIds)
          if (typeof mapping === 'object' && !Array.isArray(mapping)) {
            duplicateRequest.objectIds = mapping
          }
        } catch (e) {
          logger.warn('Invalid objectIds JSON, ignoring:', e)
        }
      }

      return {
        requests: [
          {
            duplicateObject: duplicateRequest,
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to duplicate object')
    }

    const duplicateReply = data.replies?.[0]?.duplicateObject
    const duplicatedObjectId = duplicateReply?.objectId ?? ''

    const presentationId = params?.presentationId?.trim() || ''
    const objectId = params?.objectId?.trim() || ''

    return {
      success: true,
      output: {
        duplicatedObjectId,
        metadata: {
          presentationId,
          sourceObjectId: objectId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    duplicatedObjectId: {
      type: 'string',
      description: 'The object ID of the newly created duplicate',
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata including presentation ID and source object ID',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        sourceObjectId: {
          type: 'string',
          description: 'The original object ID that was duplicated',
        },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
