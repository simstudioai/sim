import type { ToolConfig } from '@/tools/types'
import type { WebexDeleteMessageParams, WebexDeleteMessageResponse } from '@/tools/webex/types'

export const webexDeleteMessageTool: ToolConfig<
  WebexDeleteMessageParams,
  WebexDeleteMessageResponse
> = {
  id: 'webex_delete_message',
  name: 'Webex Delete Message',
  description: 'Delete a specific Webex message by its ID.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'webex',
    requiredScopes: ['spark:messages_write'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Webex API',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The message ID to delete',
    },
  },

  request: {
    url: (params) => `https://webexapis.com/v1/messages/${encodeURIComponent(params.messageId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as { message?: string }).message ||
          `Webex API error: ${response.status} ${response.statusText}`,
        output: { success: false },
      }
    }
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the deletion succeeded' },
  },
}
