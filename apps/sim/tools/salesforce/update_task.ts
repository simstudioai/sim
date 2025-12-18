import type {
  SalesforceUpdateTaskParams,
  SalesforceUpdateTaskResponse,
} from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceUpdateTaskTool: ToolConfig<
  SalesforceUpdateTaskParams,
  SalesforceUpdateTaskResponse
> = {
  id: 'salesforce_update_task',
  name: 'Update Task in Salesforce',
  description: 'Update an existing task',
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
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Status',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Priority',
    },
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

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data[0]?.message || data.message || 'Failed to update task')
    }
    return {
      success: true,
      output: {
        id: params?.taskId || '',
        updated: true,
        metadata: { operation: 'update_task' },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Updated task' },
  },
}
