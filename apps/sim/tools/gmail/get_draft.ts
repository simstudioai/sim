import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

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
    subject?: string
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
    url: (params: GmailGetDraftParams) => `${GMAIL_API_BASE}/drafts/${params.draftId}?format=full`,
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
    const getHeader = (name: string): string | undefined =>
      headers.find((h: Record<string, string>) => h.name.toLowerCase() === name.toLowerCase())
        ?.value

    let body = ''
    if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString()
    } else if (message.payload?.parts) {
      const textPart = message.payload.parts.find(
        (part: Record<string, unknown>) => part.mimeType === 'text/plain'
      )
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString()
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
        messageId: message.id ?? undefined,
        threadId: message.threadId ?? undefined,
        to: getHeader('To'),
        from: getHeader('From'),
        subject: getHeader('Subject'),
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
    subject: { type: 'string', description: 'Draft subject', optional: true },
    body: { type: 'string', description: 'Draft body text', optional: true },
    labelIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Draft labels',
      optional: true,
    },
  },
}
