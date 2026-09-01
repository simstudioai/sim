import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskListThreadsParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_THREAD_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  requireZohoDeskId,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

export const zohoDeskListThreadsTool: ToolConfig<ZohoDeskListThreadsParams, ZohoDeskResponse> = {
  id: 'zoho_desk_list_threads',
  name: 'Zoho Desk List Threads',
  description:
    'List conversation threads on a Zoho Desk ticket, newest first (Zoho sorts by sendDateTime descending by default). Returns a list projection: message bodies (content, summary, to/cc/bcc) come back only from Get Thread.',
  version: '1.0.0',

  oauth: { required: true, provider: 'zoho-desk' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zoho Desk OAuth access token',
    },
    apiDomain: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Zoho Desk data-center REST base URL',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zoho Desk organization ID',
    },
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket ID',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start index (0-based)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of threads to return (1-200, default 100)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort by sendDateTime. Zoho sorts descending (newest first) when unset; pass sendDateTime for oldest first.',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.from !== undefined) query.set('from', String(params.from))
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.sortBy) query.set('sortBy', params.sortBy)
      const qs = query.toString()
      return `${getZohoDeskApiBase(params)}/tickets/${encodeURIComponent(requireZohoDeskId(params.ticketId, 'Ticket ID'))}/threads${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        getZohoDeskErrorMessage(data, `Failed to list threads (HTTP ${response.status})`)
      )
    }
    const threads = (Array.isArray(data.data) ? data.data : []).map(withDerivedContentText)
    return {
      success: true,
      output: { threads, count: threads.length },
    }
  },

  outputs: {
    threads: {
      type: 'array',
      description: 'List of threads',
      items: { type: 'object', properties: ZOHO_DESK_THREAD_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of threads returned' },
  },
}
