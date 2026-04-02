import type { ListMessagesParams, ListMessagesResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailListMessagesTool: ToolConfig<ListMessagesParams, ListMessagesResult> = {
  id: 'agentmail_list_messages',
  name: 'List Messages',
  description: 'List messages in an inbox in AgentMail',
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
      description: 'ID of the inbox to list messages from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to return',
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
      return `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/messages${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ListMessagesResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to list messages',
        output: { messages: [], count: 0, nextPageToken: null },
      }
    }

    return {
      success: true,
      output: {
        messages: (data.messages ?? []).map((msg: Record<string, unknown>) => ({
          messageId: msg.message_id ?? '',
          from: (msg.from as string) ?? null,
          to: (msg.to as string[]) ?? [],
          subject: (msg.subject as string) ?? null,
          preview: (msg.preview as string) ?? null,
          createdAt: (msg.created_at as string) ?? '',
        })),
        count: data.count ?? 0,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'List of messages in the inbox',
      items: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Unique identifier for the message' },
          from: { type: 'string', description: 'Sender email address', optional: true },
          to: { type: 'array', description: 'Recipient email addresses' },
          subject: { type: 'string', description: 'Message subject', optional: true },
          preview: { type: 'string', description: 'Message preview text', optional: true },
          createdAt: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
    count: { type: 'number', description: 'Total number of messages' },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page',
      optional: true,
    },
  },
}
