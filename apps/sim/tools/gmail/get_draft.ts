import {
  extractExtendedHeaders,
  extractMessageBody,
  GMAIL_API_BASE,
  getHeaderValue,
} from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

interface GmailGetDraftParams {
  accessToken: string
  draftId: string
}

interface GmailGetDraftResponse {
  success: boolean
  output: {
    id: string
    messageId?: string
    threadId?: string
    to?: string
    from?: string
    cc?: string | null
    bcc?: string | null
    replyTo?: string | null
    subject?: string
    date?: string | null
    rfcMessageId?: string | null
    inReplyTo?: string | null
    references?: string | null
    snippet?: string | null
    body?: string
    labelIds?: string[]
  }
}

export const gmailGetDraftV2Tool: ToolConfig<GmailGetDraftParams, GmailGetDraftResponse> = {
  id: 'gmail_get_draft_v2',
  name: 'Gmail Get Draft',
  description: 'Get a specific draft from Gmail by its ID',
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
      description: 'ID of the draft to retrieve',
    },
  },

  request: {
    url: (params: GmailGetDraftParams) =>
      `${GMAIL_API_BASE}/drafts/${safeUrlPathSegment(params.draftId, 'draftId')}?format=full`,
    method: 'GET',
    headers: (params: GmailGetDraftParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { id: '' },
        error: data.error?.message || 'Failed to get draft',
      }
    }

    const message = data.message || {}
    const headers = message.payload?.headers || []

    const body = message.payload ? extractMessageBody(message.payload) : ''

    return {
      success: true,
      output: {
        id: data.id,
        messageId: message.id ?? undefined,
        threadId: message.threadId ?? undefined,
        to: getHeaderValue(headers, 'To'),
        from: getHeaderValue(headers, 'From'),
        subject: getHeaderValue(headers, 'Subject'),
        ...extractExtendedHeaders(headers),
        date: getHeaderValue(headers, 'Date') ?? null,
        snippet: message.snippet ?? null,
        body: body || undefined,
        labelIds: message.labelIds ?? undefined,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Draft ID' },
    messageId: { type: 'string', description: 'Gmail message ID', optional: true },
    threadId: { type: 'string', description: 'Gmail thread ID', optional: true },
    to: { type: 'string', description: 'Recipient email address', optional: true },
    from: { type: 'string', description: 'Sender email address', optional: true },
    cc: { type: 'string', description: 'Cc recipients', optional: true },
    bcc: { type: 'string', description: 'Bcc recipients', optional: true },
    replyTo: { type: 'string', description: 'Reply-To header', optional: true },
    subject: { type: 'string', description: 'Draft subject', optional: true },
    date: { type: 'string', description: 'Date header', optional: true },
    rfcMessageId: {
      type: 'string',
      description: 'RFC Message-ID header (not the Gmail message id)',
      optional: true,
    },
    inReplyTo: { type: 'string', description: 'In-Reply-To header', optional: true },
    references: { type: 'string', description: 'References header', optional: true },
    snippet: { type: 'string', description: 'Short excerpt of the draft text', optional: true },
    body: { type: 'string', description: 'Draft body text', optional: true },
    labelIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Draft labels',
      optional: true,
    },
  },
}
