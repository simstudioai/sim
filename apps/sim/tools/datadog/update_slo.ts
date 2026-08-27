import type { UpdateSloParams, UpdateSloResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
  mergeSloUpdatePayload,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const updateSloTool: ToolConfig<UpdateSloParams, UpdateSloResponse> = {
  id: 'datadog_update_slo',
  name: 'Datadog Update SLO',
  description:
    'Update a service level objective. Reads the current SLO first and applies only the fields you supply, so anything left blank keeps its stored value.',
  version: '1.0.0',

  params: {
    sloId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the service level objective to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the SLO. Leave blank to keep the current name.',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SLO type: "metric" or "monitor". Leave blank to keep the current type. Changing type requires supplying the matching query or monitorIds.',
    },
    thresholds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of thresholds replacing the stored ones, e.g. [{"timeframe": "30d", "target": 99.9, "warning": 99.95}]. Leave blank to keep the current thresholds.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the SLO',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags (e.g., "env:prod,team:core")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For metric SLOs, JSON with numerator and denominator, e.g. {"numerator": "sum:requests{status:ok}.as_count()", "denominator": "sum:requests{*}.as_count()"}',
    },
    monitorIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'For monitor SLOs, comma-separated monitor IDs (e.g., "123,456")',
    },
    groups: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated monitor groups (e.g., "env:prod,role:mysql")',
    },
    targetThreshold: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary target threshold (e.g., 99.9)',
    },
    warningThreshold: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary warning threshold, must be greater than the target (e.g., 99.95)',
    },
    timeframe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary timeframe: "7d", "30d", or "90d"',
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
    url: (params) => datadogApiUrl(params.site, `/api/v1/slo/${datadogPathSegment(params.sloId)}`),
    method: 'PUT',
    headers: datadogHeaders,
  },

  /**
   * Datadog's SLO update is a full replacement, so the stored SLO is read first and
   * the supplied edits are overlaid onto it. Sending only the filled-in fields would
   * erase every field the caller left blank.
   */
  directExecution: async (params, signal) => {
    const url = datadogApiUrl(params.site, `/api/v1/slo/${datadogPathSegment(params.sloId)}`)
    const headers = datadogHeaders(params)

    const existingResponse = await fetch(url, { method: 'GET', headers, signal })
    if (!existingResponse.ok) {
      return {
        success: false,
        output: { slo: { id: '', name: '', type: '' } },
        error: `Could not load SLO ${params.sloId} before updating it: ${await datadogErrorMessage(existingResponse)}`,
      }
    }

    const existing = await existingResponse.json()
    const stored = existing.data
    if (!stored || typeof stored !== 'object') {
      return {
        success: false,
        output: { slo: { id: '', name: '', type: '' } },
        error: `Datadog returned no SLO for id ${params.sloId}`,
      }
    }

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(mergeSloUpdatePayload(stored, params)),
      signal,
    })

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
      output: { slo: data.data?.[0] ?? { id: '', name: '', type: '' } },
    }
  },

  outputs: {
    slo: {
      type: 'object',
      description: 'The updated service level objective',
      properties: {
        id: { type: 'string', description: 'SLO ID' },
        name: { type: 'string', description: 'SLO name' },
        type: { type: 'string', description: 'SLO type' },
        description: { type: 'string', description: 'SLO description' },
        tags: { type: 'array', description: 'SLO tags' },
        thresholds: { type: 'array', description: 'Timeframe targets and warnings' },
        modified_at: { type: 'number', description: 'Modification timestamp (Unix seconds)' },
      },
    },
  },
}
