import type { DeleteThreadParams, DeleteThreadResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailDeleteThreadTool: ToolConfig<DeleteThreadParams, DeleteThreadResult> = {
  id: 'agentmail_delete_thread',
  name: 'Delete Thread',
  description:
    'Delete an email thread in AgentMail (moves to trash, or permanently deletes if already in trash)',
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
    permanent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Force permanent deletion instead of moving to trash',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.permanent) query.set('permanent', 'true')
      const qs = query.toString()
      return `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/threads/${params.threadId.trim()}${qs ? `?${qs}` : ''}`
    },
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
