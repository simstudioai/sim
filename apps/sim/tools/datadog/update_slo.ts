import type { UpdateSloParams, UpdateSloResponse } from '@/tools/datadog/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const updateSloTool: InternalToolConfig<UpdateSloParams, UpdateSloResponse> = {
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

  operation: {
    input: createInternalToolOperationInput,
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
