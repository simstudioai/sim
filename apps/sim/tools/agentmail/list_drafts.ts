import type { ListDraftsParams, ListDraftsResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailListDraftsTool: ToolConfig<ListDraftsParams, ListDraftsResult> = {
  id: 'agentmail_list_drafts',
  name: 'List Drafts',
  description: 'List email drafts in an inbox in AgentMail',
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
      description: 'ID of the inbox to list drafts from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of drafts to return',
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
      return `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/drafts${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ListDraftsResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to list drafts',
        output: { drafts: [], count: 0, nextPageToken: null },
      }
    }

    return {
      success: true,
      output: {
        drafts: (data.drafts ?? []).map((draft: Record<string, unknown>) => ({
          draftId: draft.draft_id ?? '',
          inboxId: draft.inbox_id ?? '',
          subject: (draft.subject as string) ?? null,
          to: (draft.to as string[]) ?? [],
          cc: (draft.cc as string[]) ?? [],
          bcc: (draft.bcc as string[]) ?? [],
          preview: (draft.preview as string) ?? null,
          sendStatus: (draft.send_status as string) ?? null,
          sendAt: (draft.send_at as string) ?? null,
          createdAt: (draft.created_at as string) ?? '',
          updatedAt: (draft.updated_at as string) ?? '',
        })),
        count: data.count ?? 0,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    drafts: {
      type: 'array',
      description: 'List of drafts',
      items: {
        type: 'object',
        properties: {
          draftId: { type: 'string', description: 'Unique identifier for the draft' },
          inboxId: { type: 'string', description: 'Inbox the draft belongs to' },
          subject: { type: 'string', description: 'Draft subject', optional: true },
          to: { type: 'array', description: 'Recipient email addresses' },
          cc: { type: 'array', description: 'CC email addresses' },
          bcc: { type: 'array', description: 'BCC email addresses' },
          preview: { type: 'string', description: 'Draft preview text', optional: true },
          sendStatus: {
            type: 'string',
            description: 'Send status (scheduled, sending, failed)',
            optional: true,
          },
          sendAt: { type: 'string', description: 'Scheduled send time', optional: true },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last updated timestamp' },
        },
      },
    },
    count: { type: 'number', description: 'Total number of drafts' },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page',
      optional: true,
    },
  },
}
