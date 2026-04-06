import type { ListInboxesParams, ListInboxesResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailListInboxesTool: ToolConfig<ListInboxesParams, ListInboxesResult> = {
  id: 'agentmail_list_inboxes',
  name: 'List Inboxes',
  description: 'List all email inboxes in AgentMail',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentMail API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of inboxes to return',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token for next page of results',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.limit) query.set('limit', String(params.limit))
      if (params.pageToken) query.set('page_token', params.pageToken)
      const qs = query.toString()
      return `https://api.agentmail.to/v0/inboxes${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ListInboxesResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to list inboxes',
        output: { inboxes: [], count: 0, nextPageToken: null },
      }
    }

    return {
      success: true,
      output: {
        inboxes: (data.inboxes ?? []).map((inbox: Record<string, unknown>) => ({
          inboxId: inbox.inbox_id ?? '',
          email: inbox.email ?? '',
          displayName: inbox.display_name ?? null,
          createdAt: inbox.created_at ?? '',
          updatedAt: inbox.updated_at ?? '',
        })),
        count: data.count ?? 0,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    inboxes: {
      type: 'array',
      description: 'List of inboxes',
      items: {
        type: 'object',
        properties: {
          inboxId: { type: 'string', description: 'Unique identifier for the inbox' },
          email: { type: 'string', description: 'Email address of the inbox' },
          displayName: {
            type: 'string',
            description: 'Display name of the inbox',
            optional: true,
          },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last updated timestamp' },
        },
      },
    },
    count: { type: 'number', description: 'Total number of inboxes' },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page',
      optional: true,
    },
  },
}
