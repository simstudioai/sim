import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from './types'

const logger = createLogger('WealthboxWriteTask')

export const wealthboxWriteTaskTool: ToolConfig<WealthboxWriteParams, WealthboxWriteResponse> = {
  id: 'wealthbox_write_task',
  name: 'Write Wealthbox Task',
  description: 'Create or update a Wealthbox task',
  version: '1.1',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
    },
    title: {
      type: 'string',
      required: true,
      description: 'The name/title of the task',
    },
    dueDate: {
      type: 'string',
      required: true,
      description:
        'The due date and time of the task (format: "YYYY-MM-DD HH:MM AM/PM -HHMM", e.g., "2015-05-24 11:00 AM -0400")',
    },
    complete: {
      type: 'boolean',
      required: false,
      description: 'Whether the task is complete',
    },
    category: {
      type: 'number',
      required: false,
      description: 'The category ID the task belongs to',
    },
    contactId: {
      type: 'string',
      required: false,
      description: 'ID of contact to link to this task',
    },
    taskId: {
      type: 'string',
      required: false,
      description: 'ID of existing task to update (leave empty to create new task)',
    },
  },
  request: {
    url: (params) => {
      const taskId = params.taskId?.trim()
      if (taskId) {
        // Update existing task
        return `https://api.crmworkspace.com/v1/tasks/${taskId}`
      }
      // Create new task
      return 'https://api.crmworkspace.com/v1/tasks'
    },
    method: 'POST', // Default to POST, will be handled by directExecution for updates
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      // Validate required fields
      if (!params.title?.trim()) {
        throw new Error('Task title is required')
      }
      if (!params.dueDate?.trim()) {
        throw new Error('Due date is required')
      }

      const body: Record<string, any> = {
        name: params.title.trim(),
        due_date: params.dueDate.trim(),
      }

      // Add optional fields
      if (params.complete !== undefined) {
        body.complete = params.complete
      }

      if (params.category !== undefined) {
        body.category = params.category
      }

      // Handle contact linking
      if (params.contactId?.trim()) {
        body.linked_to = [
          {
            id: Number.parseInt(params.contactId.trim()),
            type: 'Contact',
          },
        ]
      }

      return body
    },
  },
  directExecution: async (params: WealthboxWriteParams) => {
    // Debug logging to see what parameters we're receiving
    logger.info('WealthboxWriteTask received parameters:', {
      hasAccessToken: !!params.accessToken,
      hasTitle: !!params.title,
      hasDueDate: !!params.dueDate,
      title: params.title,
      dueDate: params.dueDate,
      allParams: Object.keys(params),
    })

    // Validate access token
    if (!params.accessToken) {
      throw new Error('Access token is required')
    }

    // Validate required fields
    if (!params.title?.trim()) {
      throw new Error('Task title is required')
    }
    if (!params.dueDate?.trim()) {
      throw new Error('Due date is required')
    }

    const taskId = params.taskId?.trim()
    const url = taskId
      ? `https://api.crmworkspace.com/v1/tasks/${taskId}`
      : 'https://api.crmworkspace.com/v1/tasks'

    const method = taskId ? 'PUT' : 'POST'

    const body: Record<string, any> = {
      name: params.title.trim(),
      due_date: params.dueDate.trim(),
    }

    // Add optional fields
    if (params.complete !== undefined) {
      body.complete = params.complete
    }

    if (params.category !== undefined) {
      body.category = params.category
    }

    // Handle contact linking
    if (params.contactId?.trim()) {
      body.linked_to = [
        {
          id: Number.parseInt(params.contactId.trim()),
          type: 'Contact',
        },
      ]
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Wealthbox task write API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to write Wealthbox task: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: true,
        output: {
          task: undefined,
          metadata: {
            operation: 'write_task' as const,
            taskId: params.taskId || '',
            itemType: 'task' as const,
          },
        },
      }
    }

    // Format task information into readable content
    const task = data
    const isUpdate = !!params.taskId
    let content = `Task ${isUpdate ? 'updated' : 'created'}: ${task.name || 'Unnamed task'}`

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
        success: true,
        metadata: {
          operation: 'write_task' as const,
          taskId: task.id?.toString() || params.taskId || '',
          itemType: 'task' as const,
        },
      },
    }
  },
  transformResponse: async (response: Response, params?: WealthboxWriteParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Wealthbox task write API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to write Wealthbox task: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: true,
        output: {
          task: undefined,
          metadata: {
            operation: 'write_task' as const,
            taskId: params?.taskId || '',
            itemType: 'task' as const,
          },
        },
      }
    }

    // Format task information into readable content
    const task = data
    const isUpdate = !!params?.taskId
    let content = `Task ${isUpdate ? 'updated' : 'created'}: ${task.name || 'Unnamed task'}`

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
        success: true,
        metadata: {
          operation: 'write_task' as const,
          taskId: task.id?.toString() || params?.taskId || '',
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
    return 'An error occurred while writing Wealthbox task'
  },
}
