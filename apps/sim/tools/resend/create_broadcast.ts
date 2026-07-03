import { createLogger } from '@sim/logger'
import type { CreateBroadcastParams, CreateBroadcastResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendCreateBroadcastTool')

export const resendCreateBroadcastTool: ToolConfig<CreateBroadcastParams, CreateBroadcastResult> = {
  id: 'resend_create_broadcast',
  name: 'Create Broadcast',
  description: 'Create a broadcast email for an audience in Resend',
  version: '1.0.0',

  params: {
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the audience to send the broadcast to',
    },
    broadcastFrom: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Sender email address (e.g., "sender@example.com" or "Sender Name <sender@example.com>")',
    },
    broadcastSubject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Broadcast email subject line',
    },
    broadcastHtml: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML content of the broadcast',
    },
    broadcastText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text content of the broadcast',
    },
    broadcastReplyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply-to email address',
    },
    broadcastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Friendly internal name for the broadcast',
    },
    broadcastPreviewText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preview text shown in the inbox before the email is opened',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: 'https://api.resend.com/broadcasts',
    method: 'POST',
    headers: (params: CreateBroadcastParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: CreateBroadcastParams) => ({
      audience_id: params.audienceId.trim(),
      from: params.broadcastFrom,
      subject: params.broadcastSubject,
      ...(params.broadcastHtml && { html: params.broadcastHtml }),
      ...(params.broadcastText && { text: params.broadcastText }),
      ...(params.broadcastReplyTo && { reply_to: params.broadcastReplyTo }),
      ...(params.broadcastName && { name: params.broadcastName }),
      ...(params.broadcastPreviewText && { preview_text: params.broadcastPreviewText }),
    }),
  },

  transformResponse: async (response: Response): Promise<CreateBroadcastResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Create Broadcast API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to create broadcast',
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
    id: { type: 'string', description: 'Created broadcast ID' },
  },
}
