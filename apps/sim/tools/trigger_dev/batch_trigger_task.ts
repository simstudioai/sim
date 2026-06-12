import type {
  TriggerDevBatchTriggerTaskParams,
  TriggerDevBatchTriggerTaskResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  parseJsonInput,
  TRIGGER_DEV_API_BASE,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevBatchTriggerTaskTool: ToolConfig<
  TriggerDevBatchTriggerTaskParams,
  TriggerDevBatchTriggerTaskResponse
> = {
  id: 'trigger_dev_batch_trigger_task',
  name: 'Trigger.dev Batch Trigger Task',
  description:
    'Batch trigger a Trigger.dev task with up to 1,000 payloads. All items in the batch run the same task. Returns the batch ID and the created run IDs.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    taskIdentifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the task to batch trigger (e.g., "send-welcome-email")',
    },
    items: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of batch items (max 1,000). Each item is an object with a "payload" and optional "options" (queue, concurrencyKey, idempotencyKey, ttl, delay, tags, machine). Example: [{"payload": {"userId": "user_1"}}, {"payload": {"userId": "user_2"}, "options": {"delay": "1h"}}]',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/tasks/${encodeURIComponent(params.taskIdentifier.trim())}/batch`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => {
      const items = parseJsonInput(params.items, 'items')
      if (!Array.isArray(items)) {
        throw new Error('The items parameter must be a JSON array of batch items')
      }
      return { items }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        batchId: data.batchId,
        runIds: data.runs ?? [],
      },
    }
  },

  outputs: {
    batchId: { type: 'string', description: 'ID of the batch that was triggered' },
    runIds: {
      type: 'array',
      description: 'IDs of the runs created by the batch',
      items: { type: 'string', description: 'Run ID (starts with run_)' },
    },
  },
}
