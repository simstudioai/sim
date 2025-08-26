import type { OutlookForwardParams, OutlookForwardResponse } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookForwardTool: ToolConfig<OutlookForwardParams, OutlookForwardResponse> = {
  id: 'outlook_forward',
  name: 'Outlook Forward',
  description: 'Forward an existing Outlook message to specified recipients',
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
      description: 'OAuth access token for Outlook',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to forward',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Recipient email address(es), comma-separated',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comment to include with the forwarded message',
    },
  },

  request: {
    url: (params) => {
      return `https://graph.microsoft.com/v1.0/me/messages/${params.messageId}/forward`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params: OutlookForwardParams): Record<string, any> => {
      const parseEmails = (emailString?: string) => {
        if (!emailString) return []
        return emailString
          .split(',')
          .map((email) => email.trim())
          .filter((email) => email.length > 0)
          .map((email) => ({ emailAddress: { address: email } }))
      }

      const toRecipients = parseEmails(params.to)
      if (toRecipients.length === 0) {
        throw new Error('At least one recipient is required to forward a message')
      }

      return {
        comment: params.comment ?? '',
        toRecipients,
      }
    },
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        message: 'Email forwarded successfully',
        results: {
          status: 'forwarded',
          timestamp: new Date().toISOString(),
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Email forward success status' },
    status: { type: 'string', description: 'Delivery status of the email' },
    timestamp: { type: 'string', description: 'Timestamp when email was forwarded' },
    message: { type: 'string', description: 'Success or error message' },
  },
}
