import type { CreateSloParams, CreateSloResponse } from '@/tools/datadog/types'
import {
  buildSloPayload,
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const createSloTool: ToolConfig<CreateSloParams, CreateSloResponse> = {
  id: 'datadog_create_slo',
  name: 'Datadog Create SLO',
  description:
    'Create a service level objective from a metric query, monitors, or a time-slice condition.',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the SLO (e.g., "Checkout API availability")',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SLO type: "metric" (supply query) or "monitor" (supply monitorIds). Time-slice SLOs are not supported here because they need an SLI specification this tool does not send.',
    },
    thresholds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of thresholds, e.g. [{"timeframe": "30d", "target": 99.9, "warning": 99.95}]',
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
      description:
        'For monitor SLOs with a single monitor, comma-separated monitor groups (e.g., "env:prod,role:mysql")',
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
    url: (params) => datadogApiUrl(params.site, '/api/v1/slo'),
    method: 'POST',
    headers: datadogHeaders,
    body: buildSloPayload,
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
      output: { slo: data.data?.[0] ?? { id: '', name: '', type: '' } },
    }
  },

  outputs: {
    slo: {
      type: 'object',
      description: 'The created service level objective',
      properties: {
        id: { type: 'string', description: 'SLO ID' },
        name: { type: 'string', description: 'SLO name' },
        type: { type: 'string', description: 'SLO type' },
        description: { type: 'string', description: 'SLO description' },
        tags: { type: 'array', description: 'SLO tags' },
        thresholds: { type: 'array', description: 'Timeframe targets and warnings' },
        created_at: { type: 'number', description: 'Creation timestamp (Unix seconds)' },
        modified_at: { type: 'number', description: 'Modification timestamp (Unix seconds)' },
      },
    },
  },
}
