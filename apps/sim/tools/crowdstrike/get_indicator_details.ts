import {
  CROWDSTRIKE_ERRORS_OUTPUT,
  CROWDSTRIKE_INDICATOR_OUTPUT_PROPERTIES,
} from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikeGetIndicatorDetailsParams,
  CrowdStrikeGetIndicatorDetailsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeGetIndicatorDetailsTool: ToolConfig<
  CrowdStrikeGetIndicatorDetailsParams,
  CrowdStrikeGetIndicatorDetailsResponse
> = {
  id: 'crowdstrike_get_indicator_details',
  name: 'CrowdStrike Get Indicator Details',
  description:
    'Get custom CrowdStrike Falcon indicator of compromise (IOC) records for one or more IOC IDs (GET /iocs/entities/indicators/v1). Requires the "IOC Management: Read" API scope.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client secret',
    },
    cloud: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon cloud region',
    },
    indicatorIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike IOC IDs',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      indicatorIds: params.indicatorIds,
      operation: 'crowdstrike_get_indicator_details',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike indicator details')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    indicators: {
      type: 'array',
      description: 'CrowdStrike indicator of compromise records',
      items: {
        type: 'object',
        properties: CROWDSTRIKE_INDICATOR_OUTPUT_PROPERTIES,
      },
    },
    count: {
      type: 'number',
      description: 'Number of indicators returned',
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
