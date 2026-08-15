import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

interface GmailUntrashThreadParams {
  accessToken: string
  threadId: string
}

interface GmailUntrashThreadResponse {
  success: boolean
  output: {
    id: string
    untrashed: boolean
  }
}

export const gmailUntrashThreadV2Tool: ToolConfig<
  GmailUntrashThreadParams,
  GmailUntrashThreadResponse
> = {
  id: 'gmail_untrash_thread_v2',
  name: 'Gmail Untrash Thread',
  description: 'Remove an email thread from trash in Gmail',
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
      description: 'ID of the thread to untrash',
    },
  },

  request: {
    url: (params: GmailUntrashThreadParams) =>
      `${GMAIL_API_BASE}/threads/${params.threadId}/untrash`,
    method: 'POST',
    headers: (params: GmailUntrashThreadParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { id: '', untrashed: false },
        error: data.error?.message || 'Failed to untrash thread',
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
        untrashed: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Thread ID' },
    untrashed: {
      type: 'boolean',
      description: 'Whether the thread was successfully removed from trash',
    },
  },
}
