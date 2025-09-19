import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { WebexListMessagesParams, WebexListMessagesResponse, WebexListMessages } from '@/tools/webex/types'

const logger = createLogger('WebexListMessages')

export const webexListMessagesTool: ToolConfig<WebexListMessagesParams, WebexListMessagesResponse> = {
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
      description: 'Access token for Outlook API',
    },
    roomId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Room Id',
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
      description: 'List messages sent before a message, by ID',
    },
  },
  request: {
    url: (params: WebexListMessagesParams) => {
      let baseUrl = `https://webexapis.com/v1/rooms`;
      let searchParams = new URLSearchParams();
      if (!params.roomId) {
        throw new Error('RoomId is required')
      }
      Object.keys(params).forEach(key => {
        if (key === 'accessToken') return; // Skip if it is accessToken
        let value = Object(params)[key];
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
    const data : WebexListMessages = await response.json()
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
        results: items
      },
    }
  },
  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: { type: 'array', description: 'Array of message objects' },
  },
}