import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

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
    messages: Array<{
      id: string
      threadId: string
      labelIds?: string[]
      snippet?: string
      from?: string
      to?: string
      subject?: string
      date?: string
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
      return `${GMAIL_API_BASE}/threads/${params.threadId}?format=${format}`
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

    const messages = (data.messages || []).map((message: Record<string, unknown>) => {
      const payload = message.payload as Record<string, unknown> | undefined
      const headers = (payload?.headers as Array<Record<string, string>>) || []
      const getHeader = (name: string): string | undefined =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value

      let body = ''
      const payloadBody = payload?.body as Record<string, unknown> | undefined
      if (payloadBody?.data) {
        body = Buffer.from(payloadBody.data as string, 'base64').toString()
      } else if (payload?.parts) {
        const parts = payload.parts as Array<Record<string, unknown>>
        const textPart = parts.find((part) => part.mimeType === 'text/plain')
        const textBody = textPart?.body as Record<string, unknown> | undefined
        if (textBody?.data) {
          body = Buffer.from(textBody.data as string, 'base64').toString()
        }
      }

      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds ?? null,
        snippet: message.snippet ?? null,
        from: getHeader('From') ?? null,
        to: getHeader('To') ?? null,
        subject: getHeader('Subject') ?? null,
        date: getHeader('Date') ?? null,
        body: body || null,
      }
    })

    return {
      success: true,
      output: {
        id: data.id,
        historyId: data.historyId ?? null,
        messages,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Thread ID' },
    historyId: { type: 'string', description: 'History ID', optional: true },
    messages: {
      type: 'json',
      description:
        'Array of messages in the thread with id, from, to, subject, date, body, and labels',
    },
  },
}
