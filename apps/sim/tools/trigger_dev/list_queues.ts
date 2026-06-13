import type {
  TriggerDevListQueuesParams,
  TriggerDevListQueuesResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevQueue,
  TRIGGER_DEV_API_BASE,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevListQueuesTool: ToolConfig<
  TriggerDevListQueuesParams,
  TriggerDevListQueuesResponse
> = {
  id: 'trigger_dev_list_queues',
  name: 'Trigger.dev List Queues',
  description:
    'List the queues in the environment of the API key, including running and queued counts, with page-based pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number to return (default 1)',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of queues per page',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.page) query.set('page', String(params.page))
      if (params.perPage) query.set('perPage', String(params.perPage))
      const queryString = query.toString()
      return queryString
        ? `${TRIGGER_DEV_API_BASE}/api/v1/queues?${queryString}`
        : `${TRIGGER_DEV_API_BASE}/api/v1/queues`
    },
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        queues: (data.data ?? []).map(mapTriggerDevQueue),
        pagination: {
          currentPage: data.pagination?.currentPage ?? null,
          totalPages: data.pagination?.totalPages ?? null,
          count: data.pagination?.count ?? null,
        },
      },
    }
  },

  outputs: {
    queues: {
      type: 'array',
      description: 'Queues in the environment',
      items: {
        type: 'object',
        description: 'Queue',
        properties: {
          id: { type: 'string', description: 'Unique ID of the queue (starts with queue_)' },
          name: { type: 'string', description: 'Name of the queue' },
          type: {
            type: 'string',
            description: 'Queue type (task for task-default queues, custom for named queues)',
            nullable: true,
          },
          running: {
            type: 'number',
            description: 'Number of runs currently executing',
            nullable: true,
          },
          queued: {
            type: 'number',
            description: 'Number of runs waiting in the queue',
            nullable: true,
          },
          paused: { type: 'boolean', description: 'Whether the queue is paused' },
          concurrencyLimit: {
            type: 'number',
            description: 'Maximum number of runs that can execute concurrently',
            nullable: true,
          },
          concurrency: {
            type: 'object',
            description: 'Concurrency details for the queue',
            nullable: true,
            properties: {
              current: { type: 'number', description: 'Current concurrency limit', nullable: true },
              base: { type: 'number', description: 'Base concurrency limit', nullable: true },
              override: {
                type: 'number',
                description: 'Overridden concurrency limit',
                nullable: true,
              },
              overriddenAt: {
                type: 'string',
                description: 'ISO timestamp when the concurrency limit was overridden',
                nullable: true,
              },
            },
          },
        },
      },
    },
    pagination: {
      type: 'object',
      description: 'Page-based pagination details',
      properties: {
        currentPage: { type: 'number', description: 'Current page number', nullable: true },
        totalPages: { type: 'number', description: 'Total number of pages', nullable: true },
        count: { type: 'number', description: 'Total number of queues', nullable: true },
      },
    },
  },
}
