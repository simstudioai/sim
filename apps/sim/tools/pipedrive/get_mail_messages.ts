import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveGetMailMessagesParams,
  PipedriveGetMailMessagesResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetMailMessages')

export const pipedriveGetMailMessagesTool: ToolConfig<
  PipedriveGetMailMessagesParams,
  PipedriveGetMailMessagesResponse
> = {
  id: 'pipedrive_get_mail_messages',
  name: 'Get Mail Threads from Pipedrive',
  description: 'Retrieve mail threads from Pipedrive mailbox',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'pipedrive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    folder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by folder: inbox, drafts, sent, archive (default: inbox)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to return (default: 50)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.pipedrive.com/v1/mailbox/mailThreads'
      const queryParams = new URLSearchParams()

      if (params.folder) queryParams.append('folder', params.folder)
      if (params.limit) queryParams.append('limit', params.limit)

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to fetch mail threads from Pipedrive')
    }

    const threads = data.data || []

    return {
      success: true,
      output: {
        messages: threads,
        metadata: {
          operation: 'get_mail_messages' as const,
          totalItems: threads.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Mail threads data',
      properties: {
        messages: {
          type: 'array',
          description: 'Array of mail thread objects from Pipedrive mailbox',
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
        },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
