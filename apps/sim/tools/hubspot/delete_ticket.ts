import { createLogger } from '@sim/logger'
import type { HubSpotDeleteTicketParams, HubSpotDeleteTicketResponse } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotDeleteTicket')

export const hubspotDeleteTicketTool: ToolConfig<
  HubSpotDeleteTicketParams,
  HubSpotDeleteTicketResponse
> = {
  id: 'hubspot_delete_ticket',
  name: 'Delete Ticket from HubSpot',
  description: 'Archive a ticket in HubSpot by ID (moves it to the recycling bin)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'hubspot',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the HubSpot API',
    },
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The numeric ID of the ticket to delete',
    },
  },

  request: {
    url: (params) => `https://api.hubapi.com/crm/v3/objects/tickets/${params.ticketId.trim()}`,
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete ticket from HubSpot')
    }
    return {
      success: true,
      output: {
        ticketId: params?.ticketId ?? '',
        deleted: true,
        success: true,
      },
    }
  },

  outputs: {
    ticketId: { type: 'string', description: 'ID of the deleted ticket' },
    deleted: { type: 'boolean', description: 'Whether the ticket was archived' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
