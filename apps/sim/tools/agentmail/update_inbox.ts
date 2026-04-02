import type { UpdateInboxParams, UpdateInboxResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailUpdateInboxTool: ToolConfig<UpdateInboxParams, UpdateInboxResult> = {
  id: 'agentmail_update_inbox',
  name: 'Update Inbox',
  description: 'Update the display name of an email inbox in AgentMail',
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
      description: 'ID of the inbox to update',
    },
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New display name for the inbox',
    },
  },

  request: {
    url: (params) => `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      display_name: params.displayName,
    }),
  },

  transformResponse: async (response): Promise<UpdateInboxResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to update inbox',
        output: {
          inboxId: '',
          email: '',
          displayName: null,
          createdAt: '',
          updatedAt: '',
        },
      }
    }

    return {
      success: true,
      output: {
        inboxId: data.inbox_id ?? '',
        email: data.email ?? '',
        displayName: data.display_name ?? null,
        createdAt: data.created_at ?? '',
        updatedAt: data.updated_at ?? '',
      },
    }
  },

  outputs: {
    inboxId: { type: 'string', description: 'Unique identifier for the inbox' },
    email: { type: 'string', description: 'Email address of the inbox' },
    displayName: { type: 'string', description: 'Display name of the inbox', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last updated timestamp' },
  },
}
