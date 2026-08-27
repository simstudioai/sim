import type { DeleteThreadParams, DeleteThreadResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const agentmailDeleteThreadTool: ToolConfig<DeleteThreadParams, DeleteThreadResult> = {
  id: 'agentmail_delete_thread',
  name: 'Delete Thread',
  description:
    'Permanently delete an email thread in AgentMail and all of its messages. This cannot be undone.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentMail API key',
    },
    inboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the inbox containing the thread',
    },
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the thread to delete',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${safeUrlPathSegment(params.inboxId, 'inboxId')}/threads/${safeUrlPathSegment(params.threadId, 'threadId')}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<DeleteThreadResult> => {
    if (!response.ok) {
      const data = await response.json()
      return {
        success: false,
        error: data.message ?? 'Failed to delete thread',
        output: { deleted: false },
      }
    }

    return {
      success: true,
      output: { deleted: true },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the thread was successfully deleted' },
  },
}
