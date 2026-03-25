import { createLogger } from '@sim/logger'
import type {
  HubSpotGetMarketingEventParams,
  HubSpotGetMarketingEventResponse,
} from '@/tools/hubspot/types'
import { MARKETING_EVENT_OUTPUT } from '@/tools/hubspot/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('HubSpotGetMarketingEvent')

export const hubspotGetMarketingEventTool: ToolConfig<
  HubSpotGetMarketingEventParams,
  HubSpotGetMarketingEventResponse
> = {
  id: 'hubspot_get_marketing_event',
  name: 'Get Marketing Event from HubSpot',
  description: 'Retrieve a single marketing event by ID from HubSpot',
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
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The HubSpot marketing event objectId to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.hubapi.com/marketing/v3/marketing-events/${params.eventId.trim()}`,
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
      throw new Error(data.message || 'Failed to get marketing event from HubSpot')
    }
    return {
      success: true,
      output: {
        event: data,
        eventId: data.objectId ?? data.id,
        success: true,
      },
    }
  },

  outputs: {
    event: MARKETING_EVENT_OUTPUT,
    eventId: { type: 'string', description: 'The retrieved marketing event ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
