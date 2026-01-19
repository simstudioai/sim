import type { CreatePinParams, CreatePinResponse } from '@/tools/pinterest/types'
import type { ToolConfig } from '@/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PinterestCreatePin')

export const createPinTool: ToolConfig<CreatePinParams, CreatePinResponse> = {
  id: 'pinterest_create_pin',
  name: 'Create Pinterest Pin',
  description: 'Create a new pin on a Pinterest board',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'pinterest',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pinterest OAuth access token',
    },
    board_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the board to create the pin on',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the pin',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The description of the pin',
    },
    media_url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL of the image for the pin',
    },
    link: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The destination URL when the pin is clicked (optional)',
    },
    alt_text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alt text for the image (optional)',
    },
  },

  request: {
    url: 'https://api.pinterest.com/v5/pins',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        board_id: params.board_id,
        title: params.title,
        description: params.description,
        media_source: {
          source_type: 'image_url',
          url: params.media_url,
        },
      }

      if (params.link) {
        body.link = params.link
      }

      if (params.alt_text) {
        body.alt_text = params.alt_text
      }

      return body
    },
  },

  transformResponse: async (response: Response): Promise<CreatePinResponse> => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Pinterest create pin failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        url: response.url,
      })
      return {
        success: false,
        output: {},
        error: `Pinterest API error: ${response.status} - ${errorText}`,
      }
    }

    const pin = await response.json()
    logger.info('Pinterest pin created successfully', {
      pinId: pin.id,
      boardId: pin.board_id,
    })

    return {
      success: true,
      output: {
        pin,
        pin_id: pin.id,
        pin_url: pin.link || `https://pinterest.com/pin/${pin.id}`,
      },
    }
  },
}
