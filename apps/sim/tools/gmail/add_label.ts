import type { GmailLabelParams, GmailToolResponse } from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

export const gmailAddLabelTool: ToolConfig<GmailLabelParams, GmailToolResponse> = {
  id: 'gmail_add_label',
  name: 'Gmail Add Label',
  description: 'Add label(s) to a Gmail message',
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
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to add labels to',
    },
    labelIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated label IDs to add (e.g., INBOX, Label_123)',
    },
  },

  request: {
    url: '/api/tools/gmail/add-label',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: GmailLabelParams) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
      labelIds: params.labelIds,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to add label(s)',
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
        labelIds: { type: 'array', items: { type: 'string' }, description: 'Updated email labels' },
      },
    },
  },
}

interface GmailModifyV2Response {
  success: boolean
  output: {
    id?: string
    threadId?: string
    labelIds?: string[]
  }
}

export const gmailAddLabelV2Tool: ToolConfig<GmailLabelParams, GmailModifyV2Response> = {
  id: 'gmail_add_label_v2',
  name: 'Gmail Add Label',
  description: 'Add label(s) to a Gmail message. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: gmailAddLabelTool.oauth,
  params: gmailAddLabelTool.params,
  request: gmailAddLabelTool.request,
  transformResponse: async (response) => {
    const legacy = await gmailAddLabelTool.transformResponse!(response)
    if (!legacy.success) return { success: false, output: {}, error: legacy.error }
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
      description: 'Updated email labels',
      optional: true,
    },
  },
}
