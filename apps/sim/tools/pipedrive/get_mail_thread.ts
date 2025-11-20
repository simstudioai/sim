import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveGetMailThreadParams,
  PipedriveGetMailThreadResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetMailThread')

export const pipedriveGetMailThreadTool: ToolConfig<
  PipedriveGetMailThreadParams,
  PipedriveGetMailThreadResponse
> = {
  id: 'pipedrive_get_mail_thread',
  name: 'Get Mail Thread Messages from Pipedrive',
  description: 'Retrieve all messages from a specific mail thread',
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
    thread_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the mail thread',
    },
  },

  request: {
    url: (params) =>
      `https://api.pipedrive.com/v1/mailbox/mailThreads/${params.thread_id}/mailMessages`,
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

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to fetch mail thread from Pipedrive')
    }

    const messages = data.data || []

    return {
      success: true,
      output: {
        messages,
        metadata: {
          operation: 'get_mail_thread' as const,
          threadId: params?.thread_id || '',
          totalItems: messages.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Mail thread messages data',
      properties: {
        messages: {
          type: 'array',
          description: 'Array of mail message objects from the thread',
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata including thread ID',
        },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
