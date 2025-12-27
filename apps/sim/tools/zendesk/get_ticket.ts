import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskGetTicket')

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
    metadata: {
      operation: 'get_ticket'
    }
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
      visibility: 'user-only',
      description: 'Ticket ID to retrieve',
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
        metadata: {
          operation: 'get_ticket' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    ticket: { type: 'object', description: 'Ticket object' },
    metadata: { type: 'object', description: 'Operation metadata' },
  },
}
