import { GMAIL_API_BASE } from '@/tools/gmail/utils'
import type { ToolConfig } from '@/tools/types'

interface GmailTrashThreadParams {
  accessToken: string
  threadId: string
}

interface GmailTrashThreadResponse {
  success: boolean
  output: {
    id: string
    trashed: boolean
  }
}

export const gmailTrashThreadV2Tool: ToolConfig<GmailTrashThreadParams, GmailTrashThreadResponse> =
  {
    id: 'gmail_trash_thread_v2',
    name: 'Gmail Trash Thread',
    description: 'Move an email thread to trash in Gmail',
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
        description: 'ID of the thread to trash',
      },
    },

    request: {
      url: (params: GmailTrashThreadParams) => `${GMAIL_API_BASE}/threads/${params.threadId}/trash`,
      method: 'POST',
      headers: (params: GmailTrashThreadParams) => ({
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
          output: { id: '', trashed: false },
          error: data.error?.message || 'Failed to trash thread',
        }
      }

      return {
        success: true,
        output: {
          id: data.id,
          trashed: true,
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Thread ID' },
      trashed: { type: 'boolean', description: 'Whether the thread was successfully trashed' },
    },
  }
