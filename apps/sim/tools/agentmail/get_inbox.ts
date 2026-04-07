import type { GetInboxParams, GetInboxResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailGetInboxTool: ToolConfig<GetInboxParams, GetInboxResult> = {
  id: 'agentmail_get_inbox',
  name: 'Get Inbox',
  description: 'Get details of a specific email inbox in AgentMail',
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
      description: 'ID of the inbox to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<GetInboxResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to get inbox',
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
