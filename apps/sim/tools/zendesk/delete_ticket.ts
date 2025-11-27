import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildZendeskUrl, handleZendeskError } from './types'

const logger = createLogger('ZendeskDeleteTicket')

export interface ZendeskDeleteTicketParams {
  apiToken: string
  subdomain: string
  ticketId: string
}

export interface ZendeskDeleteTicketResponse {
  success: boolean
  output: {
    deleted: boolean
    metadata: {
      operation: 'delete_ticket'
      ticketId: string
    }
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
      description: 'Ticket ID to delete',
    },
  },

  request: {
    url: (params) => buildZendeskUrl(params.subdomain, `/tickets/${params.ticketId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
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
        metadata: {
          operation: 'delete_ticket' as const,
          ticketId: params?.ticketId || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Delete confirmation',
      properties: {
        deleted: { type: 'boolean', description: 'Deletion success' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
