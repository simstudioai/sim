import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { readZohoDeskResponse } from '@/tools/zoho_desk/request'
import type { ZohoDeskGetTicketParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_TICKET_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
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
      return `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'Ticket ID')}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
    return {
      success: true,
      output: { ticket: withDerivedContentText(data) },
    }
  },

  outputs: {
    ticket: { type: 'object', description: 'The ticket', properties: ZOHO_DESK_TICKET_PROPERTIES },
  },
}
