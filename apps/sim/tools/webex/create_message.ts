import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type {
  WebexCreateMessageParams,
  WebexCreateMessageResponse,
  WebexSingleMessage,
} from '@/tools/webex/types'

const logger = createLogger('WebexCreateMessage')

export const webexCreateMessageTool: ToolConfig<
  WebexCreateMessageParams,
  WebexCreateMessageResponse
> = {
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
      visibility: 'user-only',
      description: 'Markdown message',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Parent message ID to reply to',
    },
    roomId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Room ID',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Text message',
    },
    toPersonEmail: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The recipient email address',
    },
    toPersonId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The recipient person ID',
    },
    files: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Public URLs to binary files (comma-separated), currently only one file may be included',
    },
  },
  request: {
    url: (params) => {
      const baseUrl = `https://webexapis.com/v1/messages`
      return baseUrl
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
        const files = fileString
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
        if (files.length > 0) {
          // It only picks one as only one is supported
          return [files[0]]
        }
        return undefined
      }

      const replyBody: Record<string, any> = {}
      // Only include allowed params, handle 'files' separately
      const {
        accessToken, // omit
        files,
        ...rest
      } = params

      if (files) {
        replyBody.files = parseFile(files)
      }

      Object.entries(rest).forEach(([key, value]) => {
        // Checks for truthiness, excluding parameters when they do not have value, all of them are treated as strings
        if (value) {
          replyBody[key] = value
        }
      })

      return replyBody
    },
  },
  transformResponse: async (response: Response) => {
    logger.info('Received response status: ', response.status)

    try {
      const data: WebexSingleMessage = await response.json()
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
          results: item,
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
    results: { type: 'object', description: 'Message object created' },
    createdId: { type: 'string', description: 'Created ID' },
  },
}
