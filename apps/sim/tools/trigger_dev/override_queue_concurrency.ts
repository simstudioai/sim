import type {
  TriggerDevOverrideQueueConcurrencyParams,
  TriggerDevQueueResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevQueue,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_QUEUE_OUTPUTS,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevOverrideQueueConcurrencyTool: ToolConfig<
  TriggerDevOverrideQueueConcurrencyParams,
  TriggerDevQueueResponse
> = {
  id: 'trigger_dev_override_queue_concurrency',
  name: 'Trigger.dev Override Queue Concurrency',
  description: 'Override the concurrency limit of a Trigger.dev queue with a new value.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    queueName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Queue ID (starts with queue_), task identifier, or custom queue name, depending on the queue type',
    },
    queueType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How to interpret the queue name: "id" (default) for a queue ID, "task" for a task identifier, or "custom" for a custom queue name',
    },
    concurrencyLimit: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'New concurrency limit for the queue (0 to 100000)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/queues/${encodeURIComponent(params.queueName.trim())}/concurrency/override`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => ({
      concurrencyLimit: params.concurrencyLimit,
      ...(params.queueType ? { type: params.queueType } : {}),
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: mapTriggerDevQueue(data),
    }
  },

  outputs: TRIGGER_DEV_QUEUE_OUTPUTS,
}
