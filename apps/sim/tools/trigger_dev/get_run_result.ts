import type { TriggerDevRunIdParams, TriggerDevRunResultResponse } from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevRunResult,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_RUN_RESULT_PROPERTIES,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetRunResultTool: ToolConfig<
  TriggerDevRunIdParams,
  TriggerDevRunResultResponse
> = {
  id: 'trigger_dev_get_run_result',
  name: 'Trigger.dev Get Run Result',
  description:
    'Retrieve the result of a Trigger.dev run: whether it succeeded, its output, and error details. Lighter than Get Run when only the outcome is needed.',
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
      description: 'ID of the run to retrieve the result for (starts with run_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/runs/${encodeURIComponent(params.runId.trim())}/result`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: mapTriggerDevRunResult(data),
    }
  },

  outputs: TRIGGER_DEV_RUN_RESULT_PROPERTIES,
}
