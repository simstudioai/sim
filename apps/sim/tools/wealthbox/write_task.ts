import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from './types'

const logger = createLogger('WealthboxWriteTask')

// Interface for Wealthbox task request body to replace Record<string, any>
interface WealthboxTaskRequestBody {
  name: string
  due_date: string
  description?: string // Add this field
  complete?: boolean
  category?: number
  linked_to?: Array<{
    id: number
    type: string
  }>
}

// Utility function to safely convert to string and trim
const safeStringify = (value: any): string => {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

// Utility function to validate parameters and build task body
const validateAndBuildTaskBody = (params: WealthboxWriteParams): WealthboxTaskRequestBody => {
  // Validate required fields with safe stringification
  const title = safeStringify(params.title).trim()
  const dueDate = safeStringify(params.dueDate).trim()

  if (!title) {
    throw new Error('Task title is required')
  }
  if (!dueDate) {
    throw new Error('Due date is required')
  }

  const body: WealthboxTaskRequestBody = {
    name: title,
    due_date: dueDate,
  }

  // Add optional fields with safe stringification
  const description = safeStringify(params.description).trim()
  if (description) {
    body.description = description
  }

  if (params.complete !== undefined) {
    body.complete = params.complete
  }

  if (params.category !== undefined) {
    body.category = params.category
  }

  // Handle contact linking with safe stringification
  const contactId = safeStringify(params.contactId).trim()
  if (contactId) {
    body.linked_to = [
      {
        id: Number.parseInt(contactId),
        type: 'Contact',
      },
    ]
  }

  return body
}

// Utility function to handle API errors
const handleApiError = (response: Response, errorText: string): never => {
  logger.error(
    `Wealthbox task write API error: ${response.status} ${response.statusText}`,
    errorText
  )
  throw new Error(
    `Failed to write Wealthbox task: ${response.status} ${response.statusText} - ${errorText}`
  )
}

// Utility function to format task response
const formatTaskResponse = (data: any, params?: WealthboxWriteParams): WealthboxWriteResponse => {
  if (!data) {
    return {
      success: false,
      output: {
        task: undefined,
        metadata: {
          operation: 'write_task' as const,
          itemType: 'task' as const,
        },
      },
    }
  }

  return {
    success: true,
    output: {
      task: data,
      success: true,
      metadata: {
        operation: 'write_task' as const,
        itemId: data.id?.toString() || params?.taskId || '',
        itemType: 'task' as const,
      },
    },
  }
}

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

    const body = validateAndBuildTaskBody(params)
    const url = `https://api.crmworkspace.com/v1/tasks`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      handleApiError(response, errorText)
    }

    const data = await response.json()
    return formatTaskResponse(data, params)
  },
  transformResponse: async (response: Response, params?: WealthboxWriteParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      handleApiError(response, errorText)
    }

    const data = await response.json()
    return formatTaskResponse(data, params)
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
