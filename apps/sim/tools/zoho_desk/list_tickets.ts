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
  description:
    'List tickets from a Zoho Desk organization with optional filters. Returns a list projection: description, resolution, statusType and classification are only available from Get Ticket.',
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
      description: 'Pagination start index (0-based, max 4999)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tickets to return (1-100, default 10)',
    },
    departmentIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by department ID (comma-separated for multiple)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by status, including custom statuses. Comma-separate to match multiple (e.g. "Open,On Hold")',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by priority. Comma-separate to match multiple (e.g. "High,Urgent")',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: createdTime, customerResponseTime, or responseDueDate. Prefix with - for descending.',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated related data to embed. Allowed: contacts, products, departments, team, isRead, assignee',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.from !== undefined) query.set('from', String(params.from))
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      // Zoho names this query param `departmentIds` (plural). A singular
      // `departmentId` is silently ignored, returning every department's tickets.
      if (params.departmentIds) query.set('departmentIds', params.departmentIds)
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
