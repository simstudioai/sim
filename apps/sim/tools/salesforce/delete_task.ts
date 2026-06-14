import type {
  SalesforceDeleteTaskParams,
  SalesforceDeleteTaskResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_DELETE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl, requireId } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceDeleteTaskTool: ToolConfig<
  SalesforceDeleteTaskParams,
  SalesforceDeleteTaskResponse
> = {
  id: 'salesforce_delete_task',
  name: 'Delete Task from Salesforce',
  description: 'Delete a task',
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
      visibility: 'user-or-llm',
      description: 'Salesforce Task ID to delete (18-character string starting with 00T)',
    },
  },

  request: {
    url: (params) => {
      const taskId = requireId(params.taskId, 'Task ID')
      return `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Task/${taskId}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(extractErrorMessage(data, response.status, 'Failed to delete task'))
    }
    return {
      success: true,
      output: {
        id: params?.taskId?.trim() || '',
        deleted: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deleted task data',
      properties: SOBJECT_DELETE_OUTPUT_PROPERTIES,
    },
  },
}
