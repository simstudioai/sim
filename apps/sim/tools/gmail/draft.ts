import type { GmailSendParams, GmailToolResponse } from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

export const gmailDraftTool: ToolConfig<GmailSendParams, GmailToolResponse> = {
  id: 'gmail_draft',
  name: 'Gmail Draft',
  description: 'Draft emails using Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
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
      required: false,
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
    threadId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Thread ID to reply to (for threading)',
    },
    replyToMessageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Gmail message ID to reply to - use the "id" field from Gmail Read results (not the RFC "messageId")',
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
      description: 'Files to attach to the email draft',
    },
  },

  request: {
    url: '/api/tools/gmail/draft',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: GmailSendParams) => ({
      accessToken: params.accessToken,
      to: params.to,
      subject: params.subject,
      body: params.body,
      contentType: params.contentType || 'text',
      threadId: params.threadId,
      replyToMessageId: params.replyToMessageId,
      cc: params.cc,
      bcc: params.bcc,
      attachments: params.attachments,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to create draft',
          metadata: {},
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        content: data.output.content,
        metadata: data.output.metadata,
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
