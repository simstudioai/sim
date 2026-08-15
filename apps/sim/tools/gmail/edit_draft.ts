import type { ToolConfig } from '@/tools/types'

interface GmailEditDraftParams {
  accessToken: string
  draftId: string
  to: string
  subject?: string
  body: string
  contentType?: string
  threadId?: string
  replyToMessageId?: string
  cc?: string
  bcc?: string
  attachments?: unknown
}

interface GmailEditDraftResponse {
  success: boolean
  output: {
    draftId?: string
    messageId?: string
    threadId?: string
    labelIds?: string[]
  }
}

export const gmailEditDraftV2Tool: ToolConfig<GmailEditDraftParams, GmailEditDraftResponse> = {
  id: 'gmail_edit_draft_v2',
  name: 'Gmail Edit Draft',
  description: 'Update an existing Gmail draft in place without deleting and recreating it.',
  version: '2.0.0',

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
    draftId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the draft to update (from Gmail List Drafts or Gmail Get Draft)',
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
      description: 'Thread ID to associate the draft with (for threading)',
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
    url: '/api/tools/gmail/edit-draft',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: GmailEditDraftParams) => ({
      accessToken: params.accessToken,
      draftId: params.draftId?.trim(),
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

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok || !data.success) {
      return {
        success: false,
        output: {},
        error: data.error || 'Failed to update draft',
      }
    }

    return {
      success: true,
      output: {
        draftId: data.output?.draftId ?? null,
        messageId: data.output?.messageId ?? null,
        threadId: data.output?.threadId ?? null,
        labelIds: data.output?.labelIds ?? null,
      },
    }
  },

  outputs: {
    draftId: { type: 'string', description: 'Draft ID', optional: true },
    messageId: { type: 'string', description: 'Gmail message ID for the draft', optional: true },
    threadId: { type: 'string', description: 'Gmail thread ID', optional: true },
    labelIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Email labels',
      optional: true,
    },
  },
}
