import type { GmailMessage } from '@/tools/gmail/types'
import {
  extractExtendedHeaders,
  extractMessageBody,
  GMAIL_API_BASE,
  getHeaderValue,
} from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

interface GmailGetThreadParams {
  accessToken: string
  threadId: string
  format?: string
}

interface GmailGetThreadResponse {
  success: boolean
  output: {
    id: string
    historyId?: string
    snippet?: string | null
    messages: Array<{
      id: string
      threadId: string
      labelIds?: string[]
      snippet?: string
      from?: string
      to?: string
      cc?: string | null
      bcc?: string | null
      replyTo?: string | null
      subject?: string
      date?: string
      rfcMessageId?: string | null
      inReplyTo?: string | null
      references?: string | null
      internalDate?: string | null
      body?: string
    }>
  }
}

export const gmailGetThreadV2Tool: ToolConfig<GmailGetThreadParams, GmailGetThreadResponse> = {
  id: 'gmail_get_thread_v2',
  name: 'Gmail Get Thread',
  description: 'Get a specific email thread from Gmail, including all messages in the thread',
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
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the thread to retrieve',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Format to return the messages in (full, metadata, or minimal). Defaults to full.',
    },
  },

  request: {
    url: (params: GmailGetThreadParams) => {
      const format = params.format || 'full'
      return `${GMAIL_API_BASE}/threads/${safeUrlPathSegment(params.threadId, 'threadId')}?format=${encodeURIComponent(format)}`
    },
    method: 'GET',
    headers: (params: GmailGetThreadParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { id: '', messages: [] },
        error: data.error?.message || 'Failed to get thread',
      }
    }

    const messages = (data.messages || []).map((message: Partial<GmailMessage>) => {
      const payload = message.payload
      const headers = payload?.headers || []

      const body = payload ? extractMessageBody(payload) : ''

      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds ?? null,
        snippet: message.snippet ?? null,
        from: getHeaderValue(headers, 'From') ?? null,
        to: getHeaderValue(headers, 'To') ?? null,
        subject: getHeaderValue(headers, 'Subject') ?? null,
        date: getHeaderValue(headers, 'Date') ?? null,
        body: body || null,
        ...extractExtendedHeaders(headers),
        internalDate: message.internalDate ?? null,
      }
    })

    return {
      success: true,
      output: {
        id: data.id,
        historyId: data.historyId ?? null,
        snippet: data.snippet ?? null,
        messages,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Thread ID' },
    historyId: { type: 'string', description: 'History ID', optional: true },
    snippet: { type: 'string', description: 'Short excerpt of the thread', optional: true },
    messages: {
      type: 'json',
      description:
        'Array of messages in the thread with id, threadId, labelIds, snippet, from, to, cc, bcc, replyTo, subject, date, rfcMessageId, inReplyTo, references, internalDate, and body',
    },
  },
}
