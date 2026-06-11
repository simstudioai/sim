import type {
  TriggerDevListSchedulesParams,
  TriggerDevListSchedulesResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevSchedule,
  TRIGGER_DEV_API_BASE,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevListSchedulesTool: ToolConfig<
  TriggerDevListSchedulesParams,
  TriggerDevListSchedulesResponse
> = {
  id: 'trigger_dev_list_schedules',
  name: 'Trigger.dev List Schedules',
  description: 'List Trigger.dev schedules in the project, with page-based pagination.',
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
      description: 'Number of schedules per page',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.page) query.set('page', String(params.page))
      if (params.perPage) query.set('perPage', String(params.perPage))
      const queryString = query.toString()
      return queryString
        ? `${TRIGGER_DEV_API_BASE}/api/v1/schedules?${queryString}`
        : `${TRIGGER_DEV_API_BASE}/api/v1/schedules`
    },
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        schedules: (data.data ?? []).map(mapTriggerDevSchedule),
        pagination: {
          currentPage: data.pagination?.currentPage ?? null,
          totalPages: data.pagination?.totalPages ?? null,
          count: data.pagination?.count ?? null,
        },
      },
    }
  },

  outputs: {
    schedules: {
      type: 'array',
      description: 'Schedules in the project',
      items: {
        type: 'object',
        description: 'Schedule',
        properties: {
          id: { type: 'string', description: 'Unique ID of the schedule (starts with sched_)' },
          task: { type: 'string', description: 'Identifier of the task the schedule triggers' },
          type: {
            type: 'string',
            description: 'Schedule type (DECLARATIVE or IMPERATIVE)',
            nullable: true,
          },
          active: { type: 'boolean', description: 'Whether the schedule is active' },
          deduplicationKey: {
            type: 'string',
            description: 'Deduplication key of the schedule',
            nullable: true,
          },
          externalId: {
            type: 'string',
            description: 'External ID associated with the schedule',
            nullable: true,
          },
          cron: { type: 'string', description: 'Cron expression of the schedule', nullable: true },
          cronDescription: {
            type: 'string',
            description: 'Human-readable description of the cron expression',
            nullable: true,
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone of the schedule',
            nullable: true,
          },
          nextRun: {
            type: 'string',
            description: 'ISO timestamp of the next scheduled run',
            nullable: true,
          },
          environments: {
            type: 'array',
            description: 'Environments the schedule runs in',
            items: {
              type: 'object',
              description: 'Environment the schedule is associated with',
              properties: {
                id: { type: 'string', description: 'Environment ID', nullable: true },
                type: { type: 'string', description: 'Environment type', nullable: true },
                userName: {
                  type: 'string',
                  description: 'Username for dev environments',
                  nullable: true,
                },
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
        count: { type: 'number', description: 'Total number of schedules', nullable: true },
      },
    },
  },
}
