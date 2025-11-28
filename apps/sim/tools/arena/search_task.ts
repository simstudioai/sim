import {
  getCurrentMonth,
  getCurrentWeek,
  getFutureDate,
  getLastMonth,
  getLastWeek,
  getNextMonth,
  getNextWeek,
  getPastDate,
  getToday,
  getTomorrow,
} from '@/lib/arena-utils/arena-date-utils'
import type { SearchTaskQueryParams, SearchTaskResponse } from '@/tools/arena/types'
import type { ToolConfig } from '@/tools/types'

export const searchTask: ToolConfig<SearchTaskQueryParams, SearchTaskResponse> = {
  id: 'arena_search_task',
  name: 'Arena Search Task',
  description: 'Search Tasks In Arena',
  version: '1.0.0',

  params: {
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Operation to perform (e.g., create)',
    },
    'search-task-name': {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the task',
    },
    'search-task-client': {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Client associated with the task',
    },
    'search-task-project': {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project under which the task belongs',
    },
    'search-task-assignee': {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID of the assignee',
    },
    'search-task-visbility': {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID of the assignee',
    },
    'search-task-state': {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State of the task',
    },
    'search-task-due-date': {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date of the task',
    },
  },

  request: {
    url: (params: SearchTaskQueryParams) => {
      let url = `/api/tools/arena/search-tasks`

      const isSearchTask = params.operation === 'arena_search_task'
      if (isSearchTask) {
        url += `?name=${params['search-task-name']}`
      }
      if (params['search-task-client']?.name) {
        url += `&account=${params['search-task-client'].name}`
      }
      if (params['search-task-project']) {
        url += `&projectSysId=${params['search-task-project']}`
      }
      if (params['search-task-state']) {
        url += `&statusList=${params['search-task-state'].join(',')}`
      }
      if (params['search-task-visibility']) {
        if (params['search-task-visibility'] === 'Internal') {
          url += `&taskType=INTERNAL`
        }
        if (params['search-task-visibility'] === 'Client Facing') {
          url += `&taskType=CLIENT-FACING`
        }
      }
      if (params['search-task-assignee']) {
        url += `&assigneeId=${params['search-task-assignee']}`
      }
      if (params._context?.workflowId) {
        url += `&workflowId=${params._context?.workflowId}`
      }

      if (params['search-task-due-date'] === 'Today') {
        const { startDate, endDate } = getToday()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-due-date'] === 'Tomorrow') {
        const { startDate, endDate } = getTomorrow()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      //  if(params['search-task-due-date'] === 'yesterday') {
      //     const { startDate, endDate } = getYesterday()
      //     url += `&fromDate=${startDate}`
      //     url += `&toDate=${endDate}`
      //   }
      if (params['search-task-due-date'] === 'This Week') {
        const { startDate, endDate } = getCurrentWeek()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-due-date'] === 'Next Week') {
        const { startDate, endDate } = getNextWeek()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-due-date'] === 'Last Week') {
        const { startDate, endDate } = getLastWeek()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-due-date'] === 'This Month') {
        const { startDate, endDate } = getCurrentMonth()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-due-date'] === 'Next Month') {
        const { startDate, endDate } = getNextMonth()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-due-date'] === 'Last Month') {
        const { startDate, endDate } = getLastMonth()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-due-date'] === 'Past Dates') {
        const { startDate, endDate } = getPastDate()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-due-date'] === 'Future Dates') {
        const { startDate, endDate } = getFutureDate()
        url += `&fromDate=${startDate}`
        url += `&toDate=${endDate}`
      }
      if (params['search-task-max-results']) {
        const pageSize = Number(params['search-task-max-results'])
        if (Number.isInteger(pageSize)) {
          url += `&pageSize=${pageSize}`
        }
      }
      return url
    },
    method: 'GET',
    headers: (params: SearchTaskQueryParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (
    response: Response,
    params?: SearchTaskQueryParams
  ): Promise<SearchTaskResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        success: true,
        output: data,
      },
    }
  },

  //this output config will override block output config
  outputs: {
    // ts: { type: 'string', description: 'Timestamp when response was transformed' },
    // response: { type: 'object', description: 'Response from Arena' },
    // success: { type: 'boolean', description: 'Indicates if transform was successful' },
    success: { type: 'boolean', description: 'Indicates if transform was successful' },
    output: { type: 'object', description: 'Output from Arena' },
  },
}
