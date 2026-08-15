import type { GmailMarkReadParams, GmailToolResponse } from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

export const gmailArchiveTool: ToolConfig<GmailMarkReadParams, GmailToolResponse> = {
  id: 'gmail_archive',
  name: 'Gmail Archive',
  description: 'Archive a Gmail message (remove from inbox)',
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
      description: 'ID of the message to archive',
    },
  },

  request: {
    url: '/api/tools/gmail/archive',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: GmailMarkReadParams) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to archive email',
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

export const gmailArchiveV2Tool: ToolConfig<GmailMarkReadParams, GmailModifyV2Response> = {
  id: 'gmail_archive_v2',
  name: 'Gmail Archive',
  description: 'Archive a Gmail message (remove from inbox). Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: gmailArchiveTool.oauth,
  params: gmailArchiveTool.params,
  request: gmailArchiveTool.request,
  transformResponse: async (response) => {
    const legacy = await gmailArchiveTool.transformResponse!(response)
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
