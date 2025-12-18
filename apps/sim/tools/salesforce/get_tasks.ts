import type { SalesforceGetTasksParams, SalesforceGetTasksResponse } from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceGetTasksTool: ToolConfig<
  SalesforceGetTasksParams,
  SalesforceGetTasksResponse
> = {
  id: 'salesforce_get_tasks',
  name: 'Get Tasks from Salesforce',
  description: 'Get task(s) from Salesforce',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
    },
    idToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Task ID (optional)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Max results (default: 100)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated fields',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order by field',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      if (params.taskId) {
        const fields =
          params.fields || 'Id,Subject,Status,Priority,ActivityDate,WhoId,WhatId,OwnerId'
        return `${instanceUrl}/services/data/v59.0/sobjects/Task/${params.taskId}?fields=${fields}`
      }
      const limit = params.limit ? Number.parseInt(params.limit) : 100
      const fields = params.fields || 'Id,Subject,Status,Priority,ActivityDate,WhoId,WhatId,OwnerId'
      const orderBy = params.orderBy || 'ActivityDate DESC'
      const query = `SELECT ${fields} FROM Task ORDER BY ${orderBy} LIMIT ${limit}`
      return `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params?) => {
    const data = await response.json()
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to fetch tasks')
    if (params?.taskId) {
      return {
        success: true,
        output: { task: data, metadata: { operation: 'get_tasks' }, success: true },
      }
    }
    const tasks = data.records || []
    return {
      success: true,
      output: {
        tasks,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl,
          totalSize: data.totalSize || tasks.length,
          done: data.done !== false,
        },
        metadata: { operation: 'get_tasks', totalReturned: tasks.length, hasMore: !data.done },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Task data' },
  },
}
