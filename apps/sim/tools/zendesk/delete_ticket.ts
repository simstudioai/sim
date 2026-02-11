import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from '@/tools/zendesk/types'

export interface ZendeskDeleteTicketParams {
  email: string
  apiToken: string
  subdomain: string
  ticketId: string
}

export interface ZendeskDeleteTicketResponse {
  success: boolean
  output: {
    deleted: boolean
    ticket_id: string
    success: boolean
  }
}

export const zendeskDeleteTicketTool: ToolConfig<
  ZendeskDeleteTicketParams,
  ZendeskDeleteTicketResponse
> = {
  id: 'zendesk_delete_ticket',
  name: 'Delete Ticket from Zendesk',
  description: 'Delete a ticket from Zendesk',
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
      description: 'Ticket ID to delete as a numeric string (e.g., "12345")',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, `/tickets/${params.ticketId}`),
    method: 'DELETE',
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

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'delete_ticket')
    }

    return {
      success: true,
      output: {
        deleted: true,
        ticket_id: params?.ticketId || '',
        success: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Deletion success' },
    ticket_id: { type: 'string', description: 'The deleted ticket ID' },
  },
}
