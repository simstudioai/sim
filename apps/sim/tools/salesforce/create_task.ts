import type {
  SalesforceCreateTaskParams,
  SalesforceCreateTaskResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_CREATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceCreateTaskTool: ToolConfig<
  SalesforceCreateTaskParams,
  SalesforceCreateTaskResponse
> = {
  id: 'salesforce_create_task',
  name: 'Create Task in Salesforce',
  description: 'Create a new task',
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
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task subject (required)',
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
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created task data',
      properties: SOBJECT_CREATE_OUTPUT_PROPERTIES,
    },
  },
}
