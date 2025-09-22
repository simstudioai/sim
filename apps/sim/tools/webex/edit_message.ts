import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { WebexEditMessageParams, WebexEditMessageResponse, WebexSingleMessage } from '@/tools/webex/types'

const logger = createLogger('WebexEditMessage')

export const webexEditMessageTool: ToolConfig<WebexEditMessageParams, WebexEditMessageResponse> = {
  id: 'webex_edit_message',
  name: 'Webex Edit Message',
  description: 'Edit message',
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
      visibility: 'hidden',
      description: 'Room Id',
    },
    markdown: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Markdown message',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Text message',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Message Id',
    },
  },
  request: {
    url: (params) => {
      if (!params.messageId) {
        throw new Error('Path parameter "messageId" is required')
      }
      let baseUrl = `https://webexapis.com/v1/messages/${params.messageId}`;
      return baseUrl;
    },
    method: 'PUT',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params: WebexEditMessageParams): Record<string, any> => {
      const replyBody: Record<string, any> = {}
      Object.keys(params).forEach(key => {
        if (key === 'accessToken') return; // Skip if it is 'accessToken'
        if (key === 'messageId') return; // Skip path param 'messageId'
        let value = Object(params)[key];
        // Checks for truthiness, excluding parameters when they do not have value, all of them are treated as strings
        if (!!value) {
          replyBody[key] = value
        }
      });
      return replyBody
    },
  },
  transformResponse: async (response: Response) => {
    logger.info('Received response status: ', response.status)

    try {
      const data : WebexSingleMessage = await response.json()
      // API returns messages in 'items' array
      const item = data || {}

      if (Object.keys(item).length === 0) {
        return {
          success: true,
          output: {
            message: 'No message modified.',
            results: {},
          },
        }
      }

      return {
        success: true, 
        output: {
          message: `Successfully modified ${item.id} message`,
          results: item
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
    results: { type: 'object', description: 'Message object modified' },
  },
}