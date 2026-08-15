import {
  CROWDSTRIKE_ERRORS_OUTPUT,
  CROWDSTRIKE_INDICATOR_OUTPUT_PROPERTIES,
} from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikeCreateIndicatorsParams,
  CrowdStrikeCreateIndicatorsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeCreateIndicatorsTool: ToolConfig<
  CrowdStrikeCreateIndicatorsParams,
  CrowdStrikeCreateIndicatorsResponse
> = {
  id: 'crowdstrike_create_indicators',
  name: 'CrowdStrike Create Indicators',
  description:
    'Create custom CrowdStrike Falcon indicators of compromise (POST /iocs/entities/indicators/v1). Each indicator can allow, detect, or block activity across the fleet, so a wrong value can suppress detections or break legitimate software. Requires the "IOC Management: Write" API scope.',
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
    indicators: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of indicators to create. Documented per-indicator fields: type, value, action, severity, platforms (array), applied_globally (boolean), host_groups (array), description, source, tags (array), expiration (ISO 8601), mobile_action, metadata ({ filename }). Either applied_globally must be true or host_groups must be supplied.',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Audit comment explaining why these indicators were created',
    },
    retrodetects: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to generate retroactive detections for the new indicators',
    },
    ignoreWarnings: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to create the indicators even when CrowdStrike returns warnings',
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
      comment: params.comment,
      ignoreWarnings: params.ignoreWarnings,
      indicators: params.indicators,
      operation: 'crowdstrike_create_indicators',
      retrodetects: params.retrodetects,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to create CrowdStrike indicators')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    indicators: {
      type: 'array',
      description: 'Created CrowdStrike indicator records',
      items: {
        type: 'object',
        properties: CROWDSTRIKE_INDICATOR_OUTPUT_PROPERTIES,
      },
    },
    count: {
      type: 'number',
      description: 'Number of indicators created',
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
