import {
  mapPagination,
  mapTask,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListTasksParams,
  type RocketlaneTaskListResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TASK_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListTasksTool: ToolConfig<
  RocketlaneListTasksParams,
  RocketlaneTaskListResponse
> = {
  id: 'rocketlane_list_tasks',
  name: 'Rocketlane List Tasks',
  description: 'Retrieve all Rocketlane tasks with optional filters, sorting, and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tasks per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token pointing to the next page of results, from a previous response',
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Extra fields to include in the response (startDateActual, dueDateActual, type, phase, assignees, followers, dependencies, billable, csatEnabled, priority, timeEntryCategory, financialsBudget, taskPrivateNote, parent, externalReferenceId)',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether all fields should be returned in the response',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by: taskName, startDate, dueDate, startDateActual, or dueDateActual',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: ASC or DESC',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How multiple filters combine: all (AND) or any (OR)',
    },
    projectId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by project ID',
    },
    phaseId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by phase ID',
    },
    taskName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks whose name exactly matches this value',
    },
    taskNameContains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks whose name contains this value',
    },
    taskStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by task status value',
    },
    startDateFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks with a start date on or after this date (YYYY-MM-DD)',
    },
    startDateTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks with a start date on or before this date (YYYY-MM-DD)',
    },
    dueDateFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks with a due date on or after this date (YYYY-MM-DD)',
    },
    dueDateTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks with a due date on or before this date (YYYY-MM-DD)',
    },
    includeArchive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether archived tasks should be included in the results',
    },
    externalReferenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by external reference identifier',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/tasks`)
      if (params.pageSize !== undefined) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.includeFields && params.includeFields.length > 0) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
      if (params.includeAllFields !== undefined) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.projectId !== undefined) {
        url.searchParams.set('projectId.eq', String(params.projectId))
      }
      if (params.phaseId !== undefined) {
        url.searchParams.set('phaseId.eq', String(params.phaseId))
      }
      if (params.taskName) url.searchParams.set('taskName.eq', params.taskName)
      if (params.taskNameContains) url.searchParams.set('taskName.cn', params.taskNameContains)
      if (params.taskStatus) url.searchParams.set('task.status.eq', params.taskStatus)
      if (params.startDateFrom) url.searchParams.set('startDate.ge', params.startDateFrom)
      if (params.startDateTo) url.searchParams.set('startDate.le', params.startDateTo)
      if (params.dueDateFrom) url.searchParams.set('dueDate.ge', params.dueDateFrom)
      if (params.dueDateTo) url.searchParams.set('dueDate.le', params.dueDateTo)
      if (params.includeArchive !== undefined) {
        url.searchParams.set('includeArchive.eq', String(params.includeArchive))
      }
      if (params.externalReferenceId) {
        url.searchParams.set('externalReferenceId.eq', params.externalReferenceId)
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    const tasks = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        tasks: tasks.map(mapTask),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    tasks: {
      type: 'array',
      description: 'List of tasks matching the filters',
      items: { type: 'object', properties: TASK_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
