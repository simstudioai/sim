import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { WebexListRoomsParams, WebexListRoomsResponse, WebexListRooms } from '@/tools/webex/types'

const logger = createLogger('WebexListRooms')

export const webexListRoomsTool: ToolConfig<WebexListRoomsParams, WebexListRoomsResponse> = {
  id: 'webex_list_rooms',
  name: 'Webex List Rooms',
  description: 'List rooms',
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
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Team Id',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Room type',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Made public after this timestamp',
    },
    to: {
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
    url: (params: WebexListRoomsParams) => {
      let baseUrl = `https://webexapis.com/v1/rooms`;
      let searchParams = new URLSearchParams();
      Object.keys(params).forEach(key => {
        if (key === 'accessToken') return; // Skip if it is accessToken
        let value = Object(params)[key];
        /** Checks for truthiness, excluding parameters when they do not have value
         * many of them are treated as strings
         * 'max' is a number but it does not allow 0 as value
        **/
        if (!!value) {
          searchParams.set(key, value)
        }
      });
      let paramsString = searchParams.toString()
      if (!!paramsString) {
        baseUrl += `?${paramsString}`
      }
      return baseUrl;
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
      const data : WebexListRooms = await response.json()
      logger.info('Response parsed successfully')

      // API returns rooms in 'items' array
      const items = data.items || []

      if (items.length === 0) {
        return {
          success: true,
          output: {
            message: 'No rooms found.',
            results: [],
          },
        }
      }

      return {
        success: true, 
        output: {
          message: `Successfully read ${items.length} room(s)`,
          results: items
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
    results: { type: 'array', description: 'Array of room objects' },
  },
}