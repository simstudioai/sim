import { createLogger } from '@sim/logger'
import type { HubSpotUpdateTicketParams, HubSpotUpdateTicketResponse } from '@/tools/hubspot/types'
import { TICKET_OBJECT_OUTPUT } from '@/tools/hubspot/types'
import { parseHubSpotProperties, placeholderCrmRecord } from '@/tools/hubspot/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('HubSpotUpdateTicket')

export const hubspotUpdateTicketTool: ToolConfig<
  HubSpotUpdateTicketParams,
  HubSpotUpdateTicketResponse
> = {
  id: 'hubspot_update_ticket',
  name: 'Update Ticket in HubSpot',
  description: 'Update an existing ticket in HubSpot by ID',
  version: '1.0.0',
  effect: 'write',

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
      description: 'The HubSpot ticket ID to update',
    },
    idProperty: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Property to use as unique identifier. If not specified, uses record ID',
    },
    properties: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Ticket properties to update as JSON object (e.g., {"subject": "Updated subject", "hs_ticket_priority": "HIGH"})',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.hubapi.com/crm/v3/objects/tickets/${safeUrlPathSegment(params.ticketId, 'ticketId')}`
      const queryParams = new URLSearchParams()
      if (params.idProperty) queryParams.append('idProperty', params.idProperty)
      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const properties = parseHubSpotProperties(params.properties)
      return { properties }
    },
  },

  dryRunOutput: (params) =>
    placeholderCrmRecord(
      'ticket',
      params.properties,
      params.idProperty ? undefined : String(params.ticketId).trim()
    ),

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update ticket in HubSpot')
    }
    return {
      success: true,
      output: { ticket: data, ticketId: data.id, success: true },
    }
  },

  outputs: {
    ticket: TICKET_OBJECT_OUTPUT,
    ticketId: { type: 'string', description: 'The updated ticket ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
