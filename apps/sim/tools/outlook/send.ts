import type { OutlookSendParams, OutlookSendResponse } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookSendTool: ToolConfig<OutlookSendParams, OutlookSendResponse> = {
  id: 'outlook_send',
  name: 'Outlook Send',
  description: 'Send emails using Outlook',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Outlook API',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Recipient email address',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email body content',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content type for the email body (text or html)',
    },
    replyToMessageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message ID to reply to (for threading)',
    },
    conversationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversation ID for threading',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CC recipients (comma-separated)',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCC recipients (comma-separated)',
    },
    attachments: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the email',
    },
  },

  request: {
    url: '/api/tools/outlook/send',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: OutlookSendParams) => {
      return {
        accessToken: params.accessToken,
        to: params.to,
        subject: params.subject,
        body: params.body,
        contentType: params.contentType || 'text',
        cc: params.cc || null,
        bcc: params.bcc || null,
        replyToMessageId: params.replyToMessageId || null,
        conversationId: params.conversationId || null,
        attachments: params.attachments || null,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send Outlook email')
    }
    return {
      success: true,
      output: {
        message: data.output.message,
        results: {
          status: data.output.status,
          timestamp: data.output.timestamp,
          attachmentCount: data.output.attachmentCount || 0,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Email send success status' },
    status: { type: 'string', description: 'Delivery status of the email' },
    timestamp: { type: 'string', description: 'Timestamp when email was sent' },
    message: { type: 'string', description: 'Success or error message' },
  },
}
