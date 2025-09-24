import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  WebexListMessages,
  WebexListMessagesParams,
  WebexListMessagesResponse,
} from '@/tools/webex/types'

const logger = createLogger('WebexListMessages')

export const webexListMessagesTool: ToolConfig<WebexListMessagesParams, WebexListMessagesResponse> =
  {
    id: 'webex_list_messages',
    name: 'Webex List Messages',
    description: 'List messages',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'webex',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Access token for Webex API',
      },
      roomId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Room ID',
      },
      mentionedPeople: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Mentioned People',
      },
      before: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'List messages sent before a date and time',
      },
      beforeMessage: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Made public before this timestamp',
      },
      max: {
        type: 'number',
        required: false,
        visibility: 'user-only',
        description: 'Maximum number of items to retrieve',
      },
    },
    request: {
      url: (params: WebexListMessagesParams) => {
        let baseUrl = `https://webexapis.com/v1/messages`
        const searchParams = new URLSearchParams()
        if (!params.roomId) {
          throw new Error('RoomId is required')
        }
        const { accessToken, ...rest } = params
        Object.entries(rest).forEach(([key, value]) => {
          /** Checks for truthiness, excluding parameters when they do not have value
           * many of them are treated as strings
           * 'max' is a number but it does not allow 0 as value
           **/
          if (value) {
            searchParams.set(key, String(value))
          }
        })
        const paramsString = searchParams.toString()
        if (paramsString) {
          baseUrl += `?${paramsString}`
        }
        return baseUrl
      },
      method: 'GET',
      headers: (params) => {
        // Validate access token
        if (!params.accessToken) {
          throw new Error('Access token is required')
        }

        return {
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
    },
    transformResponse: async (response: Response) => {
      logger.info('Received response status: ', response.status)

      try {
        const data: WebexListMessages = await response.json()
        // API returns messages in 'items' array
        const items = data.items || []

        if (items.length === 0) {
          return {
            success: true,
            output: {
              message: 'No messages found.',
              results: [],
            },
          }
        }

        return {
          success: true,
          output: {
            message: `Successfully read ${items.length} message(s)`,
            results: items,
          },
        }
      } catch (error) {
        logger.error('Error processing response:', {
          error,
        })
        throw error
      }
    },
    outputs: {
      message: { type: 'string', description: 'Success or status message' },
      results: { type: 'array', description: 'Array of message objects' },
    },
  }
