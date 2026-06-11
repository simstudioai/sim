import type { TriggerDevQueueParams, TriggerDevQueueResponse } from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevQueue,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_QUEUE_OUTPUTS,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetQueueTool: ToolConfig<TriggerDevQueueParams, TriggerDevQueueResponse> = {
  id: 'trigger_dev_get_queue',
  name: 'Trigger.dev Get Queue',
  description:
    'Retrieve a Trigger.dev queue by ID, task identifier, or custom queue name, including its running and queued counts.',
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
  },

  request: {
    url: (params) => {
      const base = `${TRIGGER_DEV_API_BASE}/api/v1/queues/${encodeURIComponent(params.queueName.trim())}`
      return params.queueType ? `${base}?type=${encodeURIComponent(params.queueType)}` : base
    },
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
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
