import type {
  TriggerDevTriggerTaskParams,
  TriggerDevTriggerTaskResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  parseJsonInput,
  splitCommaSeparated,
  TRIGGER_DEV_API_BASE,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevTriggerTaskTool: ToolConfig<
  TriggerDevTriggerTaskParams,
  TriggerDevTriggerTaskResponse
> = {
  id: 'trigger_dev_trigger_task',
  name: 'Trigger.dev Trigger Task',
  description:
    'Trigger a Trigger.dev task by its identifier with an optional JSON payload. Returns the ID of the created run.',
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
      description: 'Identifier of the task to trigger (e.g., "send-welcome-email")',
    },
    payload: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON payload passed to the task run. Example: {"userId": "user_123"}',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Idempotency key that ensures the task is only triggered once per key',
    },
    queue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the queue to run the task on',
    },
    concurrencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Key that scopes the queue concurrency limit (e.g., a user ID)',
    },
    delay: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Delay before the run executes, as a duration ("30m", "1h", "2d") or an ISO 8601 date',
    },
    ttl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time-to-live before an unstarted run expires, as a duration ("1h42m") or seconds',
    },
    machine: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Machine preset for the run: micro, small-1x, small-2x, medium-1x, medium-2x, large-1x, or large-2x',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags to attach to the run (max 10, each under 128 characters)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/tasks/${encodeURIComponent(params.taskIdentifier.trim())}/trigger`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}

      const payload = parseJsonInput(params.payload, 'payload')
      if (payload !== undefined) body.payload = payload

      const options: Record<string, unknown> = {}
      if (params.idempotencyKey) options.idempotencyKey = params.idempotencyKey
      if (params.queue) options.queue = { name: params.queue }
      if (params.concurrencyKey) options.concurrencyKey = params.concurrencyKey
      if (params.delay) options.delay = params.delay
      if (params.ttl) options.ttl = params.ttl
      if (params.machine) options.machine = params.machine
      if (params.tags) {
        const tags = splitCommaSeparated(params.tags)
        if (tags.length > 0) options.tags = tags
      }
      if (Object.keys(options).length > 0) body.options = options

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the run that was triggered (starts with run_)' },
  },
}
