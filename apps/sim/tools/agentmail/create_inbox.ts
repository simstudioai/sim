import type { CreateInboxParams, CreateInboxResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailCreateInboxTool: ToolConfig<CreateInboxParams, CreateInboxResult> = {
  id: 'agentmail_create_inbox',
  name: 'Create Inbox',
  description: 'Create a new email inbox with AgentMail',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentMail API key',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Username for the inbox email address',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Domain for the inbox email address',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name for the inbox',
    },
  },

  request: {
    url: 'https://api.agentmail.to/v0/inboxes',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      ...(params.username && { username: params.username }),
      ...(params.domain && { domain: params.domain }),
      ...(params.displayName && { display_name: params.displayName }),
    }),
  },

  transformResponse: async (response): Promise<CreateInboxResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to create inbox',
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
