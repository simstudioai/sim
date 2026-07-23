import { createLogger } from '@sim/logger'
import type {
  PipedriveGetMailThreadParams,
  PipedriveGetMailThreadResponse,
} from '@/tools/pipedrive/types'
import { getPipedriveAuthHeaders } from '@/tools/pipedrive/utils'
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
    authStyle: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Auth scheme for the token; set by the credential resolver for API-token service accounts',
    },
    thread_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the mail thread (e.g., "12345")',
    },
  },

  request: {
    url: (params) =>
      `https://api.pipedrive.com/v1/mailbox/mailThreads/${params.thread_id}/mailMessages`,
    method: 'GET',
    headers: (params) => getPipedriveAuthHeaders(params),
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
          thread_id: params?.thread_id || '',
          total_items: messages.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    messages: { type: 'array', description: 'Array of mail message objects from the thread' },
    metadata: {
      type: 'object',
      description: 'Thread and pagination metadata',
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
