import type { OutlookReplyParams, OutlookReplyResponse } from '@/tools/outlook/types'
import { buildOutlookRecipientMessage } from '@/tools/outlook/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const outlookReplyAllTool: ToolConfig<OutlookReplyParams, OutlookReplyResponse> = {
  id: 'outlook_reply_all',
  name: 'Outlook Reply All',
  description: 'Reply to all recipients of an Outlook message with a comment',
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
      description: 'The ID of the message to reply to',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The reply text to include above the original message',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCC recipients to add to the reply (comma-separated)',
    },
  },

  request: {
    url: (params) =>
      `https://graph.microsoft.com/v1.0/me/messages/${safeUrlPathSegment(params.messageId, 'messageId', { allowSeparators: true })}/replyAll`,
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
    body: (params) => {
      const message = buildOutlookRecipientMessage({ bcc: params.bcc })
      return message
        ? { comment: params.comment ?? '', message }
        : { comment: params.comment ?? '' }
    },
  },

  transformResponse: async (response: Response) => {
    const status = response.status
    const requestId =
      response.headers?.get('request-id') || response.headers?.get('x-ms-request-id') || undefined

    return {
      success: true,
      output: {
        message:
          status === 202 || status === 200
            ? 'Reply all sent successfully'
            : `Reply all sent (HTTP ${status})`,
        results: {
          status: 'repliedAll',
          timestamp: new Date().toISOString(),
          httpStatus: status,
          requestId,
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    results: {
      type: 'object',
      description: 'Reply-all result details',
      properties: {
        status: { type: 'string', description: 'Reply status' },
        timestamp: { type: 'string', description: 'Timestamp when the reply was sent' },
        httpStatus: {
          type: 'number',
          description: 'HTTP status code returned by the API',
          optional: true,
        },
        requestId: {
          type: 'string',
          description: 'Microsoft Graph request-id header for tracing',
          optional: true,
        },
      },
    },
  },
}
