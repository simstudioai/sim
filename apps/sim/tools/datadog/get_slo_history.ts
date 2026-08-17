import type { GetSloHistoryParams, GetSloHistoryResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const getSloHistoryTool: ToolConfig<GetSloHistoryParams, GetSloHistoryResponse> = {
  id: 'datadog_get_slo_history',
  name: 'Datadog Get SLO History',
  description:
    'Get an SLO’s history over a time window, including the overall SLI value and remaining error budget.',
  version: '1.0.0',

  params: {
    sloId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the service level objective',
    },
    fromTs: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start of the query window as a Unix timestamp in seconds',
    },
    toTs: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'End of the query window as a Unix timestamp in seconds',
    },
    target: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SLO target between 0 and 100. When supplied, the response includes the remaining error budget for a custom timeframe',
    },
    applyCorrection: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to apply SLO corrections (defaults to true)',
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
      const queryParams = new URLSearchParams({
        from_ts: String(params.fromTs),
        to_ts: String(params.toTs),
      })
      if (params.target !== undefined) queryParams.set('target', String(params.target))
      if (params.applyCorrection !== undefined)
        queryParams.set('apply_correction', String(params.applyCorrection))
      return datadogApiUrl(
        params.site,
        `/api/v1/slo/${datadogPathSegment(params.sloId)}/history?${queryParams.toString()}`
      )
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { history: {} },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()
    const history = data.data ?? {}

    return {
      success: true,
      output: {
        history,
        sliValue: history.overall?.sli_value ?? null,
      },
    }
  },

  outputs: {
    history: {
      type: 'object',
      description: 'SLO history for the requested window',
      properties: {
        from_ts: { type: 'number', description: 'Window start (Unix seconds)' },
        to_ts: { type: 'number', description: 'Window end (Unix seconds)' },
        type: { type: 'string', description: 'SLO type' },
        overall: {
          type: 'object',
          description: 'Overall SLI data for the window',
          properties: {
            sli_value: { type: 'number', description: 'SLI value over the window' },
            span_precision: { type: 'number', description: 'Decimal precision of the SLI value' },
            error_budget_remaining: {
              type: 'object',
              description: 'Remaining error budget keyed by timeframe',
            },
          },
        },
        groups: { type: 'array', description: 'Per-group SLI data for grouped SLOs' },
        monitors: { type: 'array', description: 'Per-monitor SLI data for multi-monitor SLOs' },
        thresholds: { type: 'object', description: 'Thresholds keyed by timeframe' },
      },
    },
    sliValue: {
      type: 'number',
      description: 'Overall SLI value over the window',
      optional: true,
    },
  },
}
