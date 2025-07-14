import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { WealthboxReadParams, WealthboxReadResponse } from './types'

const logger = createLogger('WealthboxReadTask')

export const wealthboxReadTaskTool: ToolConfig<WealthboxReadParams, WealthboxReadResponse> = {
  id: 'wealthbox_read_task',
  name: 'Read Wealthbox Task',
  description: 'Read content from a Wealthbox task',
  version: '1.1',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
      visibility: 'hidden',
    },
    taskId: {
      type: 'string',
      required: false,
      description: 'The ID of the task to read',
      visibility: 'user-only',
    },
  },
  request: {
    url: (params) => {
      const taskId = params.taskId?.trim()
      let url = 'https://api.crmworkspace.com/v1/tasks'
      if (taskId) {
        url = `https://api.crmworkspace.com/v1/tasks/${taskId}`
      }
      return url
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },
  transformResponse: async (response: Response, params?: WealthboxReadParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Wealthbox task API error: ${response.status} ${response.statusText}`, errorText)

      // Provide more specific error messages
      if (response.status === 404) {
        throw new Error(
          `Task with ID ${params?.taskId} not found. Please check the task ID and try again.`
        )
      }
      if (response.status === 403) {
        throw new Error(
          `Access denied to task with ID ${params?.taskId}. Please check your permissions.`
        )
      }
      throw new Error(
        `Failed to read Wealthbox task: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: true,
        output: {
          task: undefined,
          metadata: {
            operation: 'read_task' as const,
            taskId: params?.taskId || '',
            itemType: 'task' as const,
          },
        },
      }
    }

    // Format task information into readable content
    const task = data
    let content = `Task: ${task.name || 'Unnamed task'}`

    if (task.due_date) {
      content += `\nDue Date: ${new Date(task.due_date).toLocaleDateString()}`
    }

    if (task.complete !== undefined) {
      content += `\nStatus: ${task.complete ? 'Complete' : 'Incomplete'}`
    }

    if (task.priority) {
      content += `\nPriority: ${task.priority}`
    }

    if (task.category) {
      content += `\nCategory: ${task.category}`
    }

    if (task.visible_to) {
      content += `\nVisible to: ${task.visible_to}`
    }

    if (task.linked_to && task.linked_to.length > 0) {
      content += '\nLinked to:'
      task.linked_to.forEach((link: any) => {
        content += `\n  - ${link.name} (${link.type})`
      })
    }

    return {
      success: true,
      output: {
        content,
        task,
        metadata: {
          operation: 'read_task' as const,
          taskId: params?.taskId || task.id?.toString() || '',
          itemType: 'task' as const,
        },
      },
    }
  },
  transformError: (error) => {
    // If it's an Error instance with a message, use that
    if (error instanceof Error) {
      return error.message
    }

    // If it's an object with an error or message property
    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    // Default fallback message
    return 'An error occurred while reading Wealthbox task'
  },
}
