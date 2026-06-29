import { createLogger } from '@sim/logger'
import type { SendBroadcastParams, SendBroadcastResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendSendBroadcastTool')

export const resendSendBroadcastTool: ToolConfig<SendBroadcastParams, SendBroadcastResult> = {
  id: 'resend_send_broadcast',
  name: 'Send Broadcast',
  description: 'Send a broadcast immediately or schedule it for later',
  version: '1.0.0',

  params: {
    broadcastId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the broadcast to send',
    },
    broadcastScheduledAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Schedule delivery in natural language (e.g., "in 1 min") or ISO 8601 format. Sends immediately if omitted',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: SendBroadcastParams) =>
      `https://api.resend.com/broadcasts/${encodeURIComponent(params.broadcastId.trim())}/send`,
    method: 'POST',
    headers: (params: SendBroadcastParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: SendBroadcastParams) => ({
      ...(params.broadcastScheduledAt && { scheduled_at: params.broadcastScheduledAt }),
    }),
  },

  transformResponse: async (response: Response): Promise<SendBroadcastResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Send Broadcast API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to send broadcast',
        output: {
          id: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Broadcast ID' },
  },
}
