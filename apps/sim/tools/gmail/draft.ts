import type { GmailSendParams, GmailToolResponse } from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailDraftTool: ToolConfig<GmailSendParams, GmailToolResponse> = {
  id: 'gmail_draft',
  name: 'Gmail Draft',
  description: 'Draft emails using Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
    additionalScopes: [],
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
    url: () => `${GMAIL_API_BASE}/drafts`,
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
        message: {
          raw: Buffer.from(email).toString('base64url'),
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

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

  outputs: {
    content: { type: 'string', description: 'Success message' },
    metadata: {
      type: 'object',
      description: 'Draft metadata',
      properties: {
        id: { type: 'string', description: 'Draft ID' },
        message: {
          type: 'object',
          description: 'Message metadata',
          properties: {
            id: { type: 'string', description: 'Gmail message ID' },
            threadId: { type: 'string', description: 'Gmail thread ID' },
            labelIds: { type: 'array', items: { type: 'string' }, description: 'Email labels' },
          },
        },
      },
    },
  },
}
