import type { DeleteDraftParams, DeleteDraftResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailDeleteDraftTool: ToolConfig<DeleteDraftParams, DeleteDraftResult> = {
  id: 'agentmail_delete_draft',
  name: 'Delete Draft',
  description: 'Delete an email draft in AgentMail',
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
      description: 'ID of the inbox containing the draft',
    },
    draftId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the draft to delete',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/drafts/${params.draftId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<DeleteDraftResult> => {
    if (!response.ok) {
      const data = await response.json()
      return {
        success: false,
        error: data.message ?? 'Failed to delete draft',
        output: { deleted: false },
      }
    }

    return {
      success: true,
      output: { deleted: true },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the draft was successfully deleted' },
  },
}
