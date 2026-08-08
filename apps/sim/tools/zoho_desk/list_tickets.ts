import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskListTicketsParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  normalizeZohoDeskCommaList,
} from '@/tools/zoho_desk/utils'

/** The only `receivedInDays` windows Zoho documents. */
const ZOHO_DESK_RECEIVED_IN_DAYS = new Set([15, 30, 90])

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
      description: 'Pagination start index (0-based)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tickets to return (1-100)',
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
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by assignee: an agent ID, or "Unassigned". Comma-separate to match multiple.',
    },
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by origin channel, spelled as your portal spells it. Comma-separate to match multiple.',
    },
    receivedInDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      // Named for receipt, but Zoho documents it against customerResponseTime:
      // "Time period (in days) for fetching tickets based on customerResponseTime".
      // Describing it as "received" would silently drop every ticket the
      // customer has not replied to recently.
      description:
        'Only tickets whose last customer response was within the last 15, 30, or 90 days (Zoho filters on customerResponseTime, despite the name)',
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
      // Every comma-separated filter goes through the same normalizer so a
      // pasted "High, Urgent" never reaches Zoho with the separator space
      // encoded. Interior spaces survive, so "On Hold" still matches.
      // Zoho names the department param `departmentIds` (plural). A singular
      // `departmentId` is silently ignored, returning every department's tickets.
      const commaFilters = {
        departmentIds: params.departmentIds,
        status: params.status,
        priority: params.priority,
        assignee: params.assignee,
        channel: params.channel,
      }
      for (const [key, raw] of Object.entries(commaFilters)) {
        const value = normalizeZohoDeskCommaList(raw)
        if (value) query.set(key, value)
      }
      // Zoho documents exactly 15, 30 and 90. Fail loudly rather than dropping
      // the filter: this param is LLM-writable, so an agent asked for "the last
      // week" plausibly sends 7 — and silently omitting it would return the
      // entire unfiltered queue presented as a filtered result.
      // Coerced, not just checked: the tool layer does not enforce declared
      // param types, and the agent tool panel stores every picked value as a
      // string — so a user choosing "Last 30 days" sends '30', which a Set of
      // numbers would reject as invalid.
      if (params.receivedInDays !== undefined && params.receivedInDays !== null) {
        const receivedInDays = Number(params.receivedInDays)
        if (!ZOHO_DESK_RECEIVED_IN_DAYS.has(receivedInDays)) {
          throw new Error('receivedInDays must be 15, 30, or 90.')
        }
        query.set('receivedInDays', String(receivedInDays))
      }
      if (params.sortBy) query.set('sortBy', params.sortBy)
      const include = normalizeZohoDeskCommaList(params.include)
      if (include) query.set('include', include)
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
