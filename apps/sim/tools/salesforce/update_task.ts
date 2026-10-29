import type {
  SalesforceUpdateTaskParams,
  SalesforceUpdateTaskResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_UPDATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl, requireId } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceUpdateTaskTool: ToolConfig<
  SalesforceUpdateTaskParams,
  SalesforceUpdateTaskResponse
> = {
  id: 'salesforce_update_task',
  name: 'Update Task in Salesforce',
  description: 'Update an existing task',
  version: '1.0.0',
  assistant: {
    effect: 'write',
    version: 1,
    reviewFields: [
      { name: 'taskId', label: 'Task', target: true },
      { name: 'whoId', label: 'Contact or lead', target: true },
      { name: 'whatId', label: 'Related record', target: true },
      { name: 'subject', label: 'Subject', editable: true },
      { name: 'description', label: 'Description', format: 'multiline', editable: true },
      { name: 'status', label: 'Status', editable: true },
      { name: 'priority', label: 'Priority', editable: true },
      { name: 'activityDate', label: 'Due date', editable: true },
    ],
  },

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
      required: true,
      visibility: 'user-or-llm',
      description: 'Salesforce Task ID to update (18-character string starting with 00T)',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task subject',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status (e.g., Not Started, In Progress, Completed)',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority (e.g., Low, Normal, High)',
    },
    activityDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date in YYYY-MM-DD format',
    },
    whoId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Related Contact ID (003...) or Lead ID (00Q...)',
    },
    whatId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Related Account ID (001...) or Opportunity ID (006...)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task description',
    },
  },

  request: {
    url: (params) => {
      const taskId = requireId(params.taskId, 'Task ID')
      return `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Task/${taskId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string | null> = {}
      if (params.subject !== undefined) body.Subject = params.subject === '' ? null : params.subject
      if (params.status !== undefined) {
        if (!params.status.trim()) throw new Error('Task status cannot be empty')
        body.Status = params.status
      }
      if (params.priority !== undefined) {
        if (!params.priority.trim()) throw new Error('Task priority cannot be empty')
        body.Priority = params.priority
      }
      if (params.activityDate !== undefined)
        body.ActivityDate = params.activityDate === '' ? null : params.activityDate
      if (params.whoId) body.WhoId = params.whoId.trim()
      if (params.whatId) body.WhatId = params.whatId.trim()
      if (params.description !== undefined)
        body.Description = params.description === '' ? null : params.description
      return body
    },
  },

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(extractErrorMessage(data, response.status, 'Failed to update task'))
    }
    return {
      success: true,
      output: {
        id: params?.taskId?.trim() || '',
        updated: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated task data',
      properties: SOBJECT_UPDATE_OUTPUT_PROPERTIES,
    },
  },
}
