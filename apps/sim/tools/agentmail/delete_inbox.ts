import type { DeleteInboxParams, DeleteInboxResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailDeleteInboxTool: ToolConfig<DeleteInboxParams, DeleteInboxResult> = {
  id: 'agentmail_delete_inbox',
  name: 'Delete Inbox',
  description: 'Delete an email inbox in AgentMail',
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
      description: 'ID of the inbox to delete',
    },
  },

  request: {
    url: (params) => `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<DeleteInboxResult> => {
    if (!response.ok) {
      const data = await response.json()
      return {
        success: false,
        error: data.message ?? 'Failed to delete inbox',
        output: { deleted: false },
      }
    }

    return {
      success: true,
      output: { deleted: true },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the inbox was successfully deleted' },
  },
}
