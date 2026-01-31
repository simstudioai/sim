import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesUpdateSlidesPositionTool')

interface UpdateSlidesPositionParams {
  accessToken: string
  presentationId: string
  slideObjectIds: string
  insertionIndex: number
}

interface UpdateSlidesPositionResponse {
  success: boolean
  output: {
    moved: boolean
    slideObjectIds: string[]
    insertionIndex: number
    metadata: {
      presentationId: string
      url: string
    }
  }
}

export const updateSlidesPositionTool: ToolConfig<
  UpdateSlidesPositionParams,
  UpdateSlidesPositionResponse
> = {
  id: 'google_slides_update_slides_position',
  name: 'Reorder Slides in Google Slides',
  description: 'Move one or more slides to a new position in a Google Slides presentation',
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
    slideObjectIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of slide object IDs to move. The slides will maintain their relative order.',
    },
    insertionIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The zero-based index where the slides should be moved. All slides with indices greater than or equal to this will be shifted right.',
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
      if (!params.slideObjectIds?.trim()) {
        throw new Error('Slide object IDs are required')
      }
      if (params.insertionIndex === undefined || params.insertionIndex < 0) {
        throw new Error('Insertion index must be a non-negative number')
      }

      const slideObjectIds = params.slideObjectIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)

      if (slideObjectIds.length === 0) {
        throw new Error('At least one slide object ID is required')
      }

      return {
        requests: [
          {
            updateSlidesPosition: {
              slideObjectIds,
              insertionIndex: params.insertionIndex,
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
      throw new Error(data.error?.message || 'Failed to update slides position')
    }

    const presentationId = params?.presentationId?.trim() || ''
    const slideObjectIds =
      params?.slideObjectIds
        ?.split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0) ?? []

    return {
      success: true,
      output: {
        moved: true,
        slideObjectIds,
        insertionIndex: params?.insertionIndex ?? 0,
        metadata: {
          presentationId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    moved: {
      type: 'boolean',
      description: 'Whether the slides were successfully moved',
    },
    slideObjectIds: {
      type: 'array',
      description: 'The slide object IDs that were moved',
      items: {
        type: 'string',
      },
    },
    insertionIndex: {
      type: 'number',
      description: 'The index where the slides were moved to',
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
