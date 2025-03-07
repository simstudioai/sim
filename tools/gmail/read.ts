import { ToolConfig } from '../types'
import { GmailMessage, GmailReadParams, GmailToolResponse } from './types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailReadTool: ToolConfig<GmailReadParams, GmailToolResponse> = {
  id: 'gmail_read',
  name: 'Gmail Read',
  description: 'Read emails from Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
    additionalScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'Access token for Gmail API',
    },
    messageId: {
      type: 'string',
      required: true,
      description: 'ID of the message to read',
    },
  },

  request: {
    url: (params: GmailReadParams) => `${GMAIL_API_BASE}/messages/${params.messageId}`,
    method: 'GET',
    headers: (params: GmailReadParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to read email')
    }

    const message = data as GmailMessage
    const headers = message.payload.headers
    const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value
    const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value
    const to = headers.find((h) => h.name.toLowerCase() === 'to')?.value

    let body = ''
    if (message.payload.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString()
    } else if (message.payload.parts) {
      const textPart = message.payload.parts.find((p) => p.mimeType === 'text/plain')
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString()
      }
    }

    return {
      success: true,
      output: {
        content: body,
        metadata: {
          id: message.id,
          threadId: message.threadId,
          labelIds: message.labelIds,
          from,
          to,
          subject,
        },
      },
    }
  },

  transformError: (error) => {
    // Handle Google API error format
    if (error.error?.message) {
      if (error.error.message.includes('invalid authentication credentials')) {
        return 'Invalid or expired access token. Please reauthenticate.'
      }
      if (error.error.message.includes('quota')) {
        return 'Gmail API quota exceeded. Please try again later.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while reading email'
  },
}
