import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskGetTicketParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  normalizeZohoDeskCommaList,
  requireZohoDeskId,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

export const zohoDeskGetTicketTool: ToolConfig<ZohoDeskGetTicketParams, ZohoDeskResponse> = {
  id: 'zoho_desk_get_ticket',
  name: 'Zoho Desk Get Ticket',
  description: 'Retrieve a single Zoho Desk ticket by ID.',
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
      description: 'Ticket ID to retrieve',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated related data to embed. Allowed: contacts, products, assignee, departments, contract, isRead, team, skills',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      const include = normalizeZohoDeskCommaList(params.include)
      if (include) query.set('include', include)
      const qs = query.toString()
      return `${getZohoDeskApiBase(params)}/tickets/${encodeURIComponent(requireZohoDeskId(params.ticketId, 'Ticket ID'))}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        getZohoDeskErrorMessage(data, `Failed to get ticket (HTTP ${response.status})`)
      )
    }
    // Adds the derived plain-text `descriptionText` alongside the raw
    // description without mutating it. Absent or plain-text descriptions are
    // mirrored unchanged.
    return {
      success: true,
      output: { ticket: withDerivedContentText(data) },
    }
  },

  outputs: {
    ticket: { type: 'object', description: 'The ticket', properties: ZOHO_DESK_TICKET_PROPERTIES },
  },
}
