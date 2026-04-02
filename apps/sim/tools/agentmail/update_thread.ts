import type { UpdateThreadParams, UpdateThreadResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailUpdateThreadTool: ToolConfig<UpdateThreadParams, UpdateThreadResult> = {
  id: 'agentmail_update_thread',
  name: 'Update Thread Labels',
  description: 'Add or remove labels on an email thread in AgentMail',
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
      description: 'ID of the thread to update',
    },
    addLabels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated labels to add to the thread',
    },
    removeLabels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated labels to remove from the thread',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/threads/${params.threadId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      ...(params.addLabels && {
        add_labels: params.addLabels.split(',').map((l) => l.trim()),
      }),
      ...(params.removeLabels && {
        remove_labels: params.removeLabels.split(',').map((l) => l.trim()),
      }),
    }),
  },

  transformResponse: async (response): Promise<UpdateThreadResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to update thread',
        output: { threadId: '', labels: [] },
      }
    }

    return {
      success: true,
      output: {
        threadId: data.thread_id ?? '',
        labels: data.labels ?? [],
      },
    }
  },

  outputs: {
    threadId: { type: 'string', description: 'Unique identifier for the thread' },
    labels: { type: 'array', description: 'Current labels on the thread' },
  },
}
