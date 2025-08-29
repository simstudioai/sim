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

  transformResponse: async (response: Response) => {
    const status = response.status
    const requestId =
      response.headers?.get('request-id') || response.headers?.get('x-ms-request-id') || undefined

    // Graph forward action typically returns 202/204 with no body. Try to read text safely.
    let bodyText = ''
    try {
      bodyText = await response.text()
    } catch (_) {
      // ignore body read errors
    }

    // Attempt to parse JSON if present (rare for this endpoint). Extract message identifiers if available.
    let parsed: any | undefined
    if (bodyText && bodyText.trim().length > 0) {
      try {
        parsed = JSON.parse(bodyText)
      } catch (_) {
        // non-JSON body; ignore
      }
    }

    const messageId = parsed?.id || parsed?.messageId || parsed?.internetMessageId
    const internetMessageId = parsed?.internetMessageId

    return {
      success: true,
      output: {
        message:
          status === 202 || status === 204
            ? 'Email forwarded successfully'
            : `Email forwarded (HTTP ${status})`,
        results: {
          status: 'forwarded',
          timestamp: new Date().toISOString(),
          httpStatus: status,
          requestId,
          ...(messageId ? { messageId } : {}),
          ...(internetMessageId ? { internetMessageId } : {}),
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    results: {
      type: 'object',
      description: 'Delivery result details',
      properties: {
        status: { type: 'string', description: 'Delivery status of the email' },
        timestamp: { type: 'string', description: 'Timestamp when email was forwarded' },
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
        messageId: {
          type: 'string',
          description: 'Forwarded message ID if provided by API',
          optional: true,
        },
        internetMessageId: {
          type: 'string',
          description: 'RFC 822 Message-ID if provided',
          optional: true,
        },
      },
    },
  },
}
