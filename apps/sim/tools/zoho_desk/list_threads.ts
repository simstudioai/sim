import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskListThreadsParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_THREAD_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

export const zohoDeskListThreadsTool: ToolConfig<ZohoDeskListThreadsParams, ZohoDeskResponse> = {
  id: 'zoho_desk_list_threads',
  name: 'Zoho Desk List Threads',
  description: 'List conversation threads on a Zoho Desk ticket.',
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
      description: 'Pagination start index (1-based)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of threads to return (max 100)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.from !== undefined) query.set('from', String(params.from))
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      const qs = query.toString()
      return `${getZohoDeskApiBase(params)}/tickets/${encodeURIComponent(params.ticketId)}/threads${qs ? `?${qs}` : ''}`
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
