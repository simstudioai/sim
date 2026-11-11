import { ZENDESK_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  TICKET_OUTPUT_PROPERTIES,
  ZENDESK_CREDENTIAL_PARAMS,
  zendeskAuthorization,
} from '@/tools/zendesk/types'

export interface ZendeskGetTicketParams {
  email: string
  apiToken: string
  subdomain: string
  ticketId: string
}

export interface ZendeskGetTicketResponse {
  success: boolean
  output: {
    ticket: any
    ticket_id: number
    success: boolean
  }
}

export const zendeskGetTicketTool: ToolConfig<ZendeskGetTicketParams, ZendeskGetTicketResponse> = {
  id: 'zendesk_get_ticket',
  name: 'Get Single Ticket from Zendesk',
  description: 'Get a single ticket by ID from Zendesk',
  version: '1.0.0',

  oauth: ZENDESK_CREDENTIAL_OAUTH,

  params: {
    ...ZENDESK_CREDENTIAL_PARAMS,
    email: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk email address',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zendesk API token',
    },
    subdomain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk subdomain',
    },
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket ID to retrieve as a numeric string (e.g., "12345")',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, `/tickets/${params.ticketId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: zendeskAuthorization(params),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'get_ticket')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        ticket: data.ticket,
        ticket_id: data.ticket?.id,
        success: true,
      },
    }
  },

  outputs: {
    ticket: {
      type: 'object',
      description: 'Ticket object',
      properties: TICKET_OUTPUT_PROPERTIES,
    },
    ticket_id: { type: 'number', description: 'The ticket ID' },
  },
}
