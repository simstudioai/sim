import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceTasks')

function getInstanceUrl(idToken?: string, instanceUrl?: string): string {
  if (instanceUrl) return instanceUrl
  if (idToken) {
    try {
      const base64Url = idToken.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
          .join('')
      )
      const decoded = JSON.parse(jsonPayload)
      if (decoded.profile) {
        const match = decoded.profile.match(/^(https:\/\/[^/]+)/)
        if (match) return match[1]
      } else if (decoded.sub) {
        const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
        if (match && match[1] !== 'https://login.salesforce.com') return match[1]
      }
    } catch (error) {
      logger.error('Failed to decode Salesforce idToken', { error })
    }
  }
  throw new Error('Salesforce instance URL is required but not provided')
}

// Get Tasks
export const salesforceGetTasksTool: ToolConfig<any, any> = {
  id: 'salesforce_get_tasks',
  name: 'Get Tasks from Salesforce',
  description: 'Get task(s) from Salesforce',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
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
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to fetch tasks')
    if (params.taskId) {
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

// Create Task
export const salesforceCreateTaskTool: ToolConfig<any, any> = {
  id: 'salesforce_create_task',
  name: 'Create Task in Salesforce',
  description: 'Create a new task',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Task subject (required)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Status (e.g., Not Started, In Progress, Completed)',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Priority (e.g., Low, Normal, High)',
    },
    activityDate: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Due date YYYY-MM-DD',
    },
    whoId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Related Contact/Lead ID',
    },
    whatId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Related Account/Opportunity ID',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Task`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = { Subject: params.subject }
      if (params.status) body.Status = params.status
      if (params.priority) body.Priority = params.priority
      if (params.activityDate) body.ActivityDate = params.activityDate
      if (params.whoId) body.WhoId = params.whoId
      if (params.whatId) body.WhatId = params.whatId
      if (params.description) body.Description = params.description
      return body
    },
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to create task')
    return {
      success: true,
      output: {
        id: data.id,
        success: data.success,
        created: true,
        metadata: { operation: 'create_task' },
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Created task' },
  },
}

// Update Task
export const salesforceUpdateTaskTool: ToolConfig<any, any> = {
  id: 'salesforce_update_task',
  name: 'Update Task in Salesforce',
  description: 'Update an existing task',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Task ID (required)',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Task subject',
    },
    status: { type: 'string', required: false, visibility: 'user-only', description: 'Status' },
    priority: { type: 'string', required: false, visibility: 'user-only', description: 'Priority' },
    activityDate: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Due date YYYY-MM-DD',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Task/${params.taskId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.subject) body.Subject = params.subject
      if (params.status) body.Status = params.status
      if (params.priority) body.Priority = params.priority
      if (params.activityDate) body.ActivityDate = params.activityDate
      if (params.description) body.Description = params.description
      return body
    },
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data[0]?.message || data.message || 'Failed to update task')
    }
    return {
      success: true,
      output: { id: params.taskId, updated: true, metadata: { operation: 'update_task' } },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Updated task' },
  },
}

// Delete Task
export const salesforceDeleteTaskTool: ToolConfig<any, any> = {
  id: 'salesforce_delete_task',
  name: 'Delete Task from Salesforce',
  description: 'Delete a task',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Task ID (required)',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Task/${params.taskId}`,
    method: 'DELETE',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data[0]?.message || data.message || 'Failed to delete task')
    }
    return {
      success: true,
      output: { id: params.taskId, deleted: true, metadata: { operation: 'delete_task' } },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Deleted task' },
  },
}
