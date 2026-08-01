import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskListTicketsParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
} from '@/tools/zoho_desk/utils'

export const zohoDeskListTicketsTool: ToolConfig<ZohoDeskListTicketsParams, ZohoDeskResponse> = {
  id: 'zoho_desk_list_tickets',
  name: 'Zoho Desk List Tickets',
  description: 'List tickets from a Zoho Desk organization with optional filters.',
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
      description: 'Number of tickets to return (max 100)',
    },
    departmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by department ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status (e.g. Open, Closed)',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by priority (e.g. High)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field (e.g. createdTime, -modifiedTime)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated related data (contacts, assignee, departments, team, products)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.from !== undefined) query.set('from', String(params.from))
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.departmentId) query.set('departmentId', params.departmentId)
      if (params.status) query.set('status', params.status)
      if (params.priority) query.set('priority', params.priority)
      if (params.sortBy) query.set('sortBy', params.sortBy)
      if (params.include) query.set('include', params.include)
      const qs = query.toString()
      return `${getZohoDeskApiBase(params)}/tickets${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        getZohoDeskErrorMessage(data, `Failed to list tickets (HTTP ${response.status})`)
      )
    }
    const tickets = Array.isArray(data.data) ? data.data : []
    return {
      success: true,
      output: {
        tickets,
        count: tickets.length,
      },
    }
  },

  outputs: {
    tickets: {
      type: 'array',
      description: 'List of tickets',
      items: { type: 'object', properties: ZOHO_DESK_TICKET_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of tickets returned' },
  },
}
