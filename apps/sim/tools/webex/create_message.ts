import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { WebexCreateMessageParams, WebexCreateMessageResponse, WebexSingleMessage } from '@/tools/webex/types'

const logger = createLogger('WebexCreateMessage')

export const webexCreateMessageTool: ToolConfig<WebexCreateMessageParams, WebexCreateMessageResponse> = {
  id: 'webex_create_message',
  name: 'Webex Create Message',
  description: 'Create message',
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
    markdown: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Markdown message',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Parent message ID to reply to',
    },
    roomId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Room Id',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Text message',
    },
    toPersonEmail: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The recipient email address',
    },
    toPersonId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The recipient person Id',
    },
    files: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Public URLs to binary files (comma-separated), currently only one file may be included',
    },
  },
  request: {
    url: (params) => {
      let baseUrl = `https://webexapis.com/v1/messages`;
      return baseUrl;
    },
    method: 'POST',
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
    body: (params: WebexCreateMessageParams): Record<string, any> => {
      // Helper function to parse comma-separated files
      const parseFile = (fileString?: string) => {
        if (!fileString) return undefined
        let files = fileString.split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
        if (files.length > 0) {
          // It only picks one as only one is supported
          return [ files[0] ]
        }
        return undefined
      }

      const replyBody: Record<string, any> = {}
      // If replying to a message, use the reply format
      if (!!params.files) {
        replyBody.files = parseFile(params.files)
      }
      Object.keys(params).forEach(key => {
        if (key === 'accessToken') return; // Skip if it is accessToken
        if (key === 'files') return; // Skip as files has been previously handled
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
    const data : WebexSingleMessage = await response.json()
    // API returns messages in 'items' array
    const item = data || {}

    if (Object.keys(item).length === 0) {
      return {
        success: true,
        output: {
          message: 'No new message created.',
          results: {},
        },
      }
    }

    return {
      success: true, 
      output: {
        message: `Successfully created ${item.id} message`,
        createdId: item.id,
        results: item
      },
    }
  },
  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: { type: 'object', description: 'Message object created' },
    createdId: { type: 'string', description: 'Created Id'},
  },
}