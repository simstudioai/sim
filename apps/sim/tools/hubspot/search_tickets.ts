import { createLogger } from '@sim/logger'
import type {
  HubSpotSearchTicketsParams,
  HubSpotSearchTicketsResponse,
} from '@/tools/hubspot/types'
import { METADATA_OUTPUT, PAGING_OUTPUT, TICKETS_ARRAY_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotSearchTickets')

export const hubspotSearchTicketsTool: ToolConfig<
  HubSpotSearchTicketsParams,
  HubSpotSearchTicketsResponse
> = {
  id: 'hubspot_search_tickets',
  name: 'Search Tickets in HubSpot',
  description: 'Search for tickets in HubSpot using filters, sorting, and queries',
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
    filterGroups: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of filter groups as JSON. Each group contains "filters" array with objects having "propertyName", "operator" (e.g., "EQ", "NEQ", "CONTAINS_TOKEN", "NOT_CONTAINS_TOKEN"), and "value"',
    },
    sorts: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of sort objects as JSON with "propertyName" and "direction" ("ASCENDING" or "DESCENDING")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query string to match against ticket subject and other text fields',
    },
    properties: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of HubSpot property names to return (e.g., ["subject", "content", "hs_ticket_priority"])',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (max 200)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for next page (from previous response)',
    },
  },

  request: {
    url: () => 'https://api.hubapi.com/crm/v3/objects/tickets/search',
    method: 'POST',
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
      const body: Record<string, unknown> = {}
      if (params.filterGroups) {
        let parsed = params.filterGroups
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          } catch (e) {
            throw new Error(`Invalid JSON for filterGroups: ${(e as Error).message}`)
          }
        }
        if (Array.isArray(parsed) && parsed.length > 0) body.filterGroups = parsed
      }
      if (params.sorts) {
        let parsed = params.sorts
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          } catch (e) {
            throw new Error(`Invalid JSON for sorts: ${(e as Error).message}`)
          }
        }
        if (Array.isArray(parsed) && parsed.length > 0) body.sorts = parsed
      }
      if (params.query) body.query = params.query
      if (params.properties) {
        let parsed = params.properties
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          } catch (e) {
            throw new Error(`Invalid JSON for properties: ${(e as Error).message}`)
          }
        }
        if (Array.isArray(parsed) && parsed.length > 0) body.properties = parsed
      }
      if (params.limit) body.limit = params.limit
      if (params.after) body.after = params.after
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to search tickets in HubSpot')
    }
    return {
      success: true,
      output: {
        tickets: data.results || [],
        total: data.total ?? 0,
        paging: data.paging ?? null,
        metadata: {
          totalReturned: data.results?.length || 0,
          hasMore: !!data.paging?.next,
        },
        success: true,
      },
    }
  },

  outputs: {
    tickets: TICKETS_ARRAY_OUTPUT,
    total: { type: 'number', description: 'Total number of matching tickets', optional: true },
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
