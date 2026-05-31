import type { ToolConfig } from '@/tools/types'
import type { DevinListSessionMessagesParams, DevinListSessionMessagesResponse } from './types'
import { DEVIN_SESSION_MESSAGE_PROPERTIES } from './types'

export const devinListSessionMessagesTool: ToolConfig<
  DevinListSessionMessagesParams,
  DevinListSessionMessagesResponse
> = {
  id: 'devin_list_session_messages',
  name: 'list_session_messages',
  description:
    'List the messages exchanged in a Devin session, including messages from both the user and Devin.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin API key (service user credential starting with cog_)',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin organization ID (prefixed with org-)',
    },
    sessionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The session ID to list messages for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to return (1-200, default: 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor (endCursor from a previous response) to fetch the next page',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.set('first', String(params.limit))
      if (params.after) searchParams.set('after', params.after.trim())
      const qs = searchParams.toString()
      return `https://api.devin.ai/v3/organizations/${params.orgId.trim()}/sessions/${params.sessionId.trim()}/messages${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const items = data.items ?? []
    return {
      success: true,
      output: {
        messages: items.map((item: Record<string, unknown>) => ({
          eventId: item.event_id ?? null,
          source: item.source ?? null,
          message: item.message ?? null,
          createdAt: item.created_at ?? null,
        })),
        endCursor: data.end_cursor ?? null,
        hasNextPage: data.has_next_page ?? false,
        total: data.total ?? null,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Messages exchanged in the session',
      items: {
        type: 'object',
        properties: DEVIN_SESSION_MESSAGE_PROPERTIES,
      },
    },
    endCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page, or null if last page',
      optional: true,
    },
    hasNextPage: {
      type: 'boolean',
      description: 'Whether more messages are available',
    },
    total: {
      type: 'number',
      description: 'Total number of messages, if provided',
      optional: true,
    },
  },
}
