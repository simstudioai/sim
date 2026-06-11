import type {
  TriggerDevListRunsParams,
  TriggerDevListRunsResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevRunSummary,
  splitCommaSeparated,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_RUN_SUMMARY_PROPERTIES,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevListRunsTool: ToolConfig<
  TriggerDevListRunsParams,
  TriggerDevListRunsResponse
> = {
  id: 'trigger_dev_list_runs',
  name: 'Trigger.dev List Runs',
  description:
    'List Trigger.dev runs in the environment of the API key, with optional filters for status, task, version, tags, schedule, and creation time.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated run statuses to filter by: PENDING_VERSION, DELAYED, QUEUED, EXECUTING, REATTEMPTING, FROZEN, COMPLETED, CANCELED, FAILED, CRASHED, INTERRUPTED, SYSTEM_FAILURE',
    },
    taskIdentifier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated task identifiers to filter by',
    },
    version: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated worker versions to filter by (e.g., "20240101.1")',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags to filter by',
    },
    schedule: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schedule ID to filter by (starts with sched_)',
    },
    isTest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by test runs: "true" for only test runs, "false" to exclude them',
    },
    period: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return runs created in the given period (e.g., "1h", "7d")',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return runs created on or after this ISO 8601 timestamp',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return runs created on or before this ISO 8601 timestamp',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of runs per page (max 100, default 25)',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID to start the page after, for forward pagination',
    },
    pageBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID to start the page before, for backward pagination',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.pageSize) query.set('page[size]', String(params.pageSize))
      if (params.pageAfter) query.set('page[after]', params.pageAfter)
      if (params.pageBefore) query.set('page[before]', params.pageBefore)
      if (params.status) {
        for (const status of splitCommaSeparated(params.status)) {
          query.append('filter[status]', status.toUpperCase())
        }
      }
      if (params.taskIdentifier) {
        for (const task of splitCommaSeparated(params.taskIdentifier)) {
          query.append('filter[taskIdentifier]', task)
        }
      }
      if (params.version) {
        for (const version of splitCommaSeparated(params.version)) {
          query.append('filter[version]', version)
        }
      }
      if (params.tag) {
        for (const tag of splitCommaSeparated(params.tag)) {
          query.append('filter[tag]', tag)
        }
      }
      if (params.schedule) query.set('filter[schedule]', params.schedule)
      if (params.isTest === 'true' || params.isTest === 'false') {
        query.set('filter[isTest]', params.isTest)
      }
      if (params.period) query.set('filter[createdAt][period]', params.period)
      if (params.from) query.set('filter[createdAt][from]', params.from)
      if (params.to) query.set('filter[createdAt][to]', params.to)

      const queryString = query.toString()
      return queryString
        ? `${TRIGGER_DEV_API_BASE}/api/v1/runs?${queryString}`
        : `${TRIGGER_DEV_API_BASE}/api/v1/runs`
    },
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        runs: (data.data ?? []).map(mapTriggerDevRunSummary),
        pagination: {
          next: data.pagination?.next ?? null,
          previous: data.pagination?.previous ?? null,
        },
      },
    }
  },

  outputs: {
    runs: {
      type: 'array',
      description: 'Runs matching the filters',
      items: {
        type: 'object',
        description: 'Run summary',
        properties: TRIGGER_DEV_RUN_SUMMARY_PROPERTIES,
      },
    },
    pagination: {
      type: 'object',
      description: 'Cursor pagination details',
      properties: {
        next: {
          type: 'string',
          description: 'Run ID to start the next page after',
          nullable: true,
        },
        previous: {
          type: 'string',
          description: 'Run ID to start the previous page before',
          nullable: true,
        },
      },
    },
  },
}
