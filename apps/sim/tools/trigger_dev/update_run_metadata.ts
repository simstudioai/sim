import type {
  TriggerDevUpdateRunMetadataParams,
  TriggerDevUpdateRunMetadataResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  parseJsonInput,
  TRIGGER_DEV_API_BASE,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevUpdateRunMetadataTool: ToolConfig<
  TriggerDevUpdateRunMetadataParams,
  TriggerDevUpdateRunMetadataResponse
> = {
  id: 'trigger_dev_update_run_metadata',
  name: 'Trigger.dev Update Run Metadata',
  description: 'Replace the metadata of a Trigger.dev run with a new JSON object.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the run to update (starts with run_)',
    },
    metadata: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON object to set as the run metadata. Example: {"stage": "approved"}',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/runs/${encodeURIComponent(params.runId.trim())}/metadata`,
    method: 'PUT',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => ({ metadata: parseJsonInput(params.metadata, 'metadata') ?? {} }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        metadata: data.metadata ?? null,
      },
    }
  },

  outputs: {
    metadata: { type: 'json', description: 'The updated metadata of the run' },
  },
}
