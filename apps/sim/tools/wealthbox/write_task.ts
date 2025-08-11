import type { ToolConfig } from '@/tools/types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from '@/tools/wealthbox/types'
import { formatTaskResponse, validateAndBuildTaskBody } from '@/tools/wealthbox/utils'

export const wealthboxWriteTaskTool: ToolConfig<WealthboxWriteParams, WealthboxWriteResponse> = {
  id: 'wealthbox_write_task',
  name: 'Write Wealthbox Task',
  description: 'Create or update a Wealthbox task',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
      visibility: 'hidden',
    },
    title: {
      type: 'string',
      required: true,
      description: 'The name/title of the task',
      visibility: 'user-or-llm',
    },
    dueDate: {
      type: 'string',
      required: true,
      description:
        'The due date and time of the task (format: "YYYY-MM-DD HH:MM AM/PM -HHMM", e.g., "2015-05-24 11:00 AM -0400")',
      visibility: 'user-or-llm',
    },
    contactId: {
      type: 'string',
      required: false,
      description: 'ID of contact to link to this task',
      visibility: 'user-only',
    },
    description: {
      type: 'string',
      required: false,
      description: 'Description or notes about the task',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const taskId = params.taskId?.trim()
      if (taskId) {
        return `https://api.crmworkspace.com/v1/tasks/${taskId}`
      }
      return 'https://api.crmworkspace.com/v1/tasks'
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      return validateAndBuildTaskBody(params)
    },
  },

  transformResponse: async (response: Response, params?: WealthboxWriteParams) => {
    const data = await response.json()
    return formatTaskResponse(data, params)
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created or updated task data and metadata',
      properties: {
        task: { type: 'object', description: 'Raw task data from Wealthbox' },
        success: { type: 'boolean', description: 'Operation success indicator' },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            operation: { type: 'string', description: 'The operation performed' },
            itemId: { type: 'string', description: 'ID of the created/updated task' },
            itemType: { type: 'string', description: 'Type of item (task)' },
          },
        },
      },
    },
  },
}
