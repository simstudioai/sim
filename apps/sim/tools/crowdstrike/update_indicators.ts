import {
  CROWDSTRIKE_ERRORS_OUTPUT,
  CROWDSTRIKE_INDICATOR_OUTPUT_PROPERTIES,
} from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikeUpdateIndicatorsParams,
  CrowdStrikeUpdateIndicatorsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeUpdateIndicatorsTool: ToolConfig<
  CrowdStrikeUpdateIndicatorsParams,
  CrowdStrikeUpdateIndicatorsResponse
> = {
  id: 'crowdstrike_update_indicators',
  name: 'CrowdStrike Update Indicators',
  description:
    'Update existing custom CrowdStrike Falcon indicators of compromise by ID (PATCH /iocs/entities/indicators/v1). Changing an indicator action or scope changes prevention behavior across the fleet. Indicator type and value are immutable. Requires the "IOC Management: Write" API scope.',
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
        'JSON array of indicators to update. Each entry requires id. Documented updatable fields: action, severity, description, source, tags (array), platforms (array), applied_globally (boolean), host_groups (array), expiration (ISO 8601), mobile_action, metadata ({ filename }). type and value cannot be changed.',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Audit comment explaining why these indicators were updated',
    },
    retrodetects: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to generate retroactive detections for the updated indicators',
    },
    ignoreWarnings: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to apply the updates even when CrowdStrike returns warnings',
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
      operation: 'crowdstrike_update_indicators',
      retrodetects: params.retrodetects,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to update CrowdStrike indicators')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    indicators: {
      type: 'array',
      description: 'Updated CrowdStrike indicator records',
      items: {
        type: 'object',
        properties: CROWDSTRIKE_INDICATOR_OUTPUT_PROPERTIES,
      },
    },
    count: {
      type: 'number',
      description: 'Number of indicators updated',
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
