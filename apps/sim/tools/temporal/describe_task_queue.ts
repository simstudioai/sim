import type {
  TemporalDescribeTaskQueueParams,
  TemporalDescribeTaskQueueResponse,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  temporalNamespaceUrl,
  temporalRequestHeaders,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

export const describeTaskQueueTool: ToolConfig<
  TemporalDescribeTaskQueueParams,
  TemporalDescribeTaskQueueResponse
> = {
  id: 'temporal_describe_task_queue',
  name: 'Temporal Describe Task Queue',
  description:
    'List the workers currently polling a Temporal task queue, to check whether a workflow or activity has live workers.',
  version: '1.0.0',

  params: {
    serverUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: "Base URL of the Temporal server's HTTP API (e.g., http://localhost:7243)",
    },
    namespace: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Temporal namespace (e.g., default)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key sent as a Bearer token (leave blank for servers without auth)',
    },
    taskQueue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the task queue to describe (e.g., orders)',
    },
    taskQueueType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Type of pollers to list: TASK_QUEUE_TYPE_WORKFLOW (default) or TASK_QUEUE_TYPE_ACTIVITY',
    },
  },

  request: {
    url: (params) => {
      const base = `${temporalNamespaceUrl(params.serverUrl, params.namespace)}/task-queues/${encodeURIComponent(params.taskQueue.trim())}`
      return params.taskQueueType
        ? `${base}?taskQueueType=${encodeURIComponent(params.taskQueueType)}`
        : base
    },
    method: 'GET',
    headers: (params) => temporalRequestHeaders(params),
  },

  transformResponse: async (response: Response, params) => {
    const data = await parseTemporalResponse<{
      pollers?: Array<{
        identity?: string
        lastAccessTime?: string
        ratePerSecond?: number
      }>
    }>(response, 'describe task queue')

    return {
      success: true,
      output: {
        taskQueue: params?.taskQueue?.trim() ?? '',
        pollers: (data.pollers ?? []).map((poller) => ({
          identity: poller.identity ?? null,
          lastAccessTime: poller.lastAccessTime ?? null,
          ratePerSecond: poller.ratePerSecond ?? null,
        })),
      },
    }
  },

  outputs: {
    taskQueue: { type: 'string', description: 'Name of the described task queue' },
    pollers: {
      type: 'array',
      description: 'Workers currently polling the task queue (empty when no workers are running)',
      items: {
        type: 'object',
        properties: {
          identity: { type: 'string', description: 'Identity of the polling worker' },
          lastAccessTime: {
            type: 'string',
            description: 'Last time the worker polled the queue (RFC 3339)',
          },
          ratePerSecond: { type: 'number', description: 'Poller rate per second' },
        },
      },
    },
  },
}
