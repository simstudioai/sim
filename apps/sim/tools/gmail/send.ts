import type { GmailSendParams, GmailToolResponse } from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailSendTool: ToolConfig<GmailSendParams, GmailToolResponse> = {
  id: 'gmail_send',
  name: 'Gmail Send',
  description: 'Send emails using Gmail',
  version: '1.0.0',

  outputs: {
    content: { type: 'string', description: 'Success message' },
    metadata: {
      type: 'object',
      description: 'Email metadata',
      properties: {
        id: { type: 'string', description: 'Gmail message ID' },
        threadId: { type: 'string', description: 'Gmail thread ID' },
        labelIds: { type: 'array', items: { type: 'string' }, description: 'Email labels' },
      },
    },
  },

  oauth: {
    required: true,
    provider: 'google-email',
    additionalScopes: ['https://www.googleapis.com/auth/gmail.send'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Gmail API',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
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
  },

  request: {
    url: () => `${GMAIL_API_BASE}/messages/send`,
    method: 'POST',
    headers: (params: GmailSendParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GmailSendParams): Record<string, any> => {
      const emailHeaders = [
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        `To: ${params.to}`,
      ]

      if (params.cc) {
        emailHeaders.push(`Cc: ${params.cc}`)
      }
      if (params.bcc) {
        emailHeaders.push(`Bcc: ${params.bcc}`)
      }

      emailHeaders.push(`Subject: ${params.subject}`, '', params.body)
      const email = emailHeaders.join('\n')

      return {
        raw: Buffer.from(email).toString('base64url'),
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to send email')
    }

    return {
      success: true,
      output: {
        content: 'Email sent successfully',
        metadata: {
          id: data.id,
          threadId: data.threadId,
          labelIds: data.labelIds,
        },
      },
    }
  },

  transformError: (error) => {
    if (error.error?.message) {
      if (error.error.message.includes('invalid authentication credentials')) {
        return 'Invalid or expired access token. Please reauthenticate.'
      }
      if (error.error.message.includes('quota')) {
        return 'Gmail API quota exceeded. Please try again later.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while sending email'
  },
}
