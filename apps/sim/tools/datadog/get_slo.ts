import type { GetSloParams, GetSloResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const getSloTool: ToolConfig<GetSloParams, GetSloResponse> = {
  id: 'datadog_get_slo',
  name: 'Datadog Get SLO',
  description: 'Get the configuration of a single service level objective by ID.',
  version: '1.0.0',

  params: {
    sloId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the service level objective',
    },
    withConfiguredAlertIds: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the IDs of SLO monitors that reference this SLO',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => {
      const queryString = params.withConfiguredAlertIds ? '?with_configured_alert_ids=true' : ''
      return datadogApiUrl(
        params.site,
        `/api/v1/slo/${datadogPathSegment(params.sloId)}${queryString}`
      )
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { slo: { id: '', name: '', type: '' } },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: { slo: data.data ?? { id: '', name: '', type: '' } },
    }
  },

  outputs: {
    slo: {
      type: 'object',
      description: 'The service level objective',
      properties: {
        id: { type: 'string', description: 'SLO ID' },
        name: { type: 'string', description: 'SLO name' },
        type: { type: 'string', description: 'SLO type: metric, monitor, or time_slice' },
        description: { type: 'string', description: 'SLO description' },
        tags: { type: 'array', description: 'SLO tags' },
        thresholds: { type: 'array', description: 'Timeframe targets and warnings' },
        target_threshold: { type: 'number', description: 'Primary target threshold' },
        warning_threshold: { type: 'number', description: 'Primary warning threshold' },
        timeframe: { type: 'string', description: 'Primary timeframe' },
        monitor_ids: { type: 'array', description: 'Monitor IDs for monitor-based SLOs' },
        groups: { type: 'array', description: 'Monitor groups narrowing the SLO scope' },
        configured_alert_ids: {
          type: 'array',
          description: 'SLO monitor IDs referencing this SLO',
          optional: true,
        },
        created_at: { type: 'number', description: 'Creation timestamp (Unix seconds)' },
        modified_at: { type: 'number', description: 'Modification timestamp (Unix seconds)' },
      },
    },
  },
}
