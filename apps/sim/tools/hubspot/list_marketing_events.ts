import { createLogger } from '@sim/logger'
import type {
  HubSpotListMarketingEventsParams,
  HubSpotListMarketingEventsResponse,
} from '@/tools/hubspot/types'
import {
  MARKETING_EVENTS_ARRAY_OUTPUT,
  METADATA_OUTPUT,
  PAGING_OUTPUT,
} from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotListMarketingEvents')

export const hubspotListMarketingEventsTool: ToolConfig<
  HubSpotListMarketingEventsParams,
  HubSpotListMarketingEventsResponse
> = {
  id: 'hubspot_list_marketing_events',
  name: 'List Marketing Events from HubSpot',
  description: 'Retrieve all marketing events from HubSpot account with pagination support',
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
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results per page (max 100, default 10)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for next page of results (from previous response)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = 'https://api.hubapi.com/marketing/v3/marketing-events'
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.after) queryParams.append('after', params.after)
      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('HubSpot API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list marketing events from HubSpot')
    }
    const results = data.results || []
    return {
      success: true,
      output: {
        events: results,
        paging: data.paging ?? null,
        metadata: {
          totalReturned: results.length,
          hasMore: !!data.paging?.next,
        },
        success: true,
      },
    }
  },

  outputs: {
    events: MARKETING_EVENTS_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
