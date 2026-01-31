import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  TICKET_OUTPUT_PROPERTIES,
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

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk email address',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
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
    headers: (params) => {
      // Use Basic Authentication with email/token format for Zendesk API tokens
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
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
