import {
  CROWDSTRIKE_ALERT_OUTPUT_PROPERTIES,
  CROWDSTRIKE_ERRORS_OUTPUT,
} from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikeGetAlertDetailsParams,
  CrowdStrikeGetAlertDetailsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeGetAlertDetailsTool: ToolConfig<
  CrowdStrikeGetAlertDetailsParams,
  CrowdStrikeGetAlertDetailsResponse
> = {
  id: 'crowdstrike_get_alert_details',
  name: 'CrowdStrike Get Alert Details',
  description:
    'Get full CrowdStrike Falcon alert records for one or more composite alert IDs (POST /alerts/entities/alerts/v2). Requires the "Alerts: Read" API scope.',
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
    compositeIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike composite alert IDs',
    },
    includeHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include previously hidden alerts (CrowdStrike defaults this to true)',
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
      compositeIds: params.compositeIds,
      includeHidden: params.includeHidden,
      operation: 'crowdstrike_get_alert_details',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike alert details')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    alerts: {
      type: 'array',
      description: 'CrowdStrike alert records',
      items: {
        type: 'object',
        properties: CROWDSTRIKE_ALERT_OUTPUT_PROPERTIES,
      },
    },
    count: {
      type: 'number',
      description: 'Number of alerts returned',
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}
