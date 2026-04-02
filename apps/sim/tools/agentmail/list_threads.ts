import type { ListThreadsParams, ListThreadsResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailListThreadsTool: ToolConfig<ListThreadsParams, ListThreadsResult> = {
  id: 'agentmail_list_threads',
  name: 'List Threads',
  description: 'List email threads in AgentMail',
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
      description: 'ID of the inbox to list threads from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of threads to return',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token for next page of results',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated labels to filter threads by',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter threads before this ISO 8601 timestamp',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter threads after this ISO 8601 timestamp',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.limit) query.set('limit', String(params.limit))
      if (params.pageToken) query.set('page_token', params.pageToken)
      if (params.labels) {
        for (const label of params.labels.split(',')) {
          query.append('labels', label.trim())
        }
      }
      if (params.before) query.set('before', params.before)
      if (params.after) query.set('after', params.after)
      const qs = query.toString()
      return `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/threads${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ListThreadsResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to list threads',
        output: { threads: [], count: 0, nextPageToken: null },
      }
    }

    return {
      success: true,
      output: {
        threads: (data.threads ?? []).map((thread: Record<string, unknown>) => ({
          threadId: thread.thread_id ?? '',
          subject: (thread.subject as string) ?? null,
          senders: (thread.senders as string[]) ?? [],
          recipients: (thread.recipients as string[]) ?? [],
          messageCount: (thread.message_count as number) ?? 0,
          lastMessageAt: (thread.timestamp as string) ?? null,
          createdAt: (thread.created_at as string) ?? '',
          updatedAt: (thread.updated_at as string) ?? '',
        })),
        count: data.count ?? 0,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    threads: {
      type: 'array',
      description: 'List of email threads',
      items: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Unique identifier for the thread' },
          subject: { type: 'string', description: 'Thread subject', optional: true },
          senders: { type: 'array', description: 'List of sender email addresses' },
          recipients: { type: 'array', description: 'List of recipient email addresses' },
          messageCount: { type: 'number', description: 'Number of messages in the thread' },
          lastMessageAt: {
            type: 'string',
            description: 'Timestamp of last message',
            optional: true,
          },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last updated timestamp' },
        },
      },
    },
    count: { type: 'number', description: 'Total number of threads' },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page',
      optional: true,
    },
  },
}
