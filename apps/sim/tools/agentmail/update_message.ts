import type { UpdateMessageParams, UpdateMessageResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailUpdateMessageTool: ToolConfig<UpdateMessageParams, UpdateMessageResult> = {
  id: 'agentmail_update_message',
  name: 'Update Message',
  description: 'Add or remove labels on an email message in AgentMail',
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
      description: 'ID of the inbox containing the message',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to update',
    },
    addLabels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated labels to add to the message',
    },
    removeLabels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated labels to remove from the message',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/messages/${params.messageId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.addLabels) {
        body.add_labels = params.addLabels.split(',').map((l) => l.trim())
      }
      if (params.removeLabels) {
        body.remove_labels = params.removeLabels.split(',').map((l) => l.trim())
      }
      return body
    },
  },

  transformResponse: async (response): Promise<UpdateMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to update message',
        output: { messageId: '', labels: [] },
      }
    }

    return {
      success: true,
      output: {
        messageId: data.message_id ?? '',
        labels: data.labels ?? [],
      },
    }
  },

  outputs: {
    messageId: { type: 'string', description: 'Unique identifier for the message' },
    labels: { type: 'array', description: 'Current labels on the message' },
  },
}
