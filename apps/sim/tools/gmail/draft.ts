import type { ToolConfig } from '../types'
import type { GmailSendParams, GmailToolResponse } from './types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailDraftTool: ToolConfig<GmailSendParams, GmailToolResponse> = {
  id: 'gmail_draft',
  name: 'Gmail Draft',
  description: 'Draft emails using Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
    additionalScopes: ['https://www.googleapis.com/auth/gmail.compose'],
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
  },

  request: {
    url: () => `${GMAIL_API_BASE}/drafts`,
    method: 'POST',
    headers: (params: GmailSendParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GmailSendParams): Record<string, any> => {
      const email = [
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        `To: ${params.to}`,
        `Subject: ${params.subject}`,
        '',
        params.body,
      ].join('\n')

      return {
        message: {
          raw: Buffer.from(email).toString('base64url'),
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to draft email')
    }

    return {
      success: true,
      output: {
        content: 'Email drafted successfully',
        metadata: {
          id: data.id,
          message: {
            id: data.message?.id,
            threadId: data.message?.threadId,
            labelIds: data.message?.labelIds,
          },
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
    return error.message || 'An unexpected error occurred while drafting email'
  },
}
