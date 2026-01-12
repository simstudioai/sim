import type { GmailSendParams, GmailToolResponse } from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

export const gmailSendTool: ToolConfig<GmailSendParams, GmailToolResponse> = {
  id: 'gmail_send',
  name: 'Gmail Send',
  description: 'Send emails using Gmail',
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
      description: 'Files to attach to the email',
    },
  },

  request: {
    url: '/api/tools/gmail/send',
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
          content: data.error || 'Failed to send email',
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
      description: 'Email metadata',
      properties: {
        id: { type: 'string', description: 'Gmail message ID' },
        threadId: { type: 'string', description: 'Gmail thread ID' },
        labelIds: { type: 'array', items: { type: 'string' }, description: 'Email labels' },
      },
    },
  },
}

interface GmailSendV2Response {
  success: boolean
  output: {
    id?: string
    threadId?: string
    labelIds?: string[]
  }
}

export const gmailSendV2Tool: ToolConfig<GmailSendParams, GmailSendV2Response> = {
  id: 'gmail_send_v2',
  name: 'Gmail Send',
  description: 'Send emails using Gmail. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: gmailSendTool.oauth,
  params: gmailSendTool.params,
  request: gmailSendTool.request,
  transformResponse: async (response) => {
    const legacy = await gmailSendTool.transformResponse!(response)
    if (!legacy.success) {
      return {
        success: false,
        output: {},
        error: legacy.error,
      }
    }

    const metadata = legacy.output.metadata as any
    return {
      success: true,
      output: {
        id: metadata?.id ?? null,
        threadId: metadata?.threadId ?? null,
        labelIds: metadata?.labelIds ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Gmail message ID', optional: true },
    threadId: { type: 'string', description: 'Gmail thread ID', optional: true },
    labelIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Email labels',
      optional: true,
    },
  },
}
