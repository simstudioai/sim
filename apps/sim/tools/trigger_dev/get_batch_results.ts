import type {
  TriggerDevBatchIdParams,
  TriggerDevBatchResultsResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevRunResult,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_RUN_RESULT_PROPERTIES,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetBatchResultsTool: ToolConfig<
  TriggerDevBatchIdParams,
  TriggerDevBatchResultsResponse
> = {
  id: 'trigger_dev_get_batch_results',
  name: 'Trigger.dev Get Batch Results',
  description:
    'Retrieve the execution results of every run in a Trigger.dev batch, including outputs and error details.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    batchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the batch to retrieve results for (starts with batch_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/batches/${encodeURIComponent(params.batchId.trim())}/results`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        items: (data.items ?? []).map(mapTriggerDevRunResult),
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the batch (starts with batch_)' },
    items: {
      type: 'array',
      description: 'Execution results for each run in the batch',
      items: {
        type: 'object',
        description: 'Run result',
        properties: TRIGGER_DEV_RUN_RESULT_PROPERTIES,
      },
    },
  },
}
