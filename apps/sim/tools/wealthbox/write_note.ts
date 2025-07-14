import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from './types'

const logger = createLogger('WealthboxWriteNote')

// Utility function to validate parameters and build note body
const validateAndBuildNoteBody = (params: WealthboxWriteParams): Record<string, any> => {
  // Handle content conversion - stringify if not already a string
  let content: string

  if (params.content === null || params.content === undefined) {
    throw new Error('Note content is required')
  }

  if (typeof params.content === 'string') {
    content = params.content
  } else {
    content = JSON.stringify(params.content)
  }

  content = content.trim()

  if (!content) {
    throw new Error('Note content is required')
  }

  const body: Record<string, any> = {
    content: content,
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
}

// Utility function to handle API errors
const handleApiError = (response: Response, errorText: string): never => {
  logger.error(
    `Wealthbox note write API error: ${response.status} ${response.statusText}`,
    errorText
  )
  throw new Error(
    `Failed to create Wealthbox note: ${response.status} ${response.statusText} - ${errorText}`
  )
}

// Utility function to format note response
const formatNoteResponse = (data: any): WealthboxWriteResponse => {
  if (!data) {
    return {
      success: false,
      output: {
        note: undefined,
        metadata: {
          operation: 'write_note' as const,
          itemType: 'note' as const,
        },
      },
    }
  }

  return {
    success: true,
    output: {
      note: data,
      success: true,
      metadata: {
        operation: 'write_note' as const,
        itemId: data.id?.toString() || '',
        itemType: 'note' as const,
      },
    },
  }
}

export const wealthboxWriteNoteTool: ToolConfig<WealthboxWriteParams, WealthboxWriteResponse> = {
  id: 'wealthbox_write_note',
  name: 'Write Wealthbox Note',
  description: 'Create or update a Wealthbox note',
  version: '1.1',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
      visibility: 'hidden',
    },
    content: {
      type: 'string',
      required: true,
      description: 'The main body of the note',
      visibility: 'user-or-llm',
    },
    contactId: {
      type: 'string',
      required: false,
      description: 'ID of contact to link to this note',
      visibility: 'user-only',
    },
  },
  request: {
    url: 'https://api.crmworkspace.com/v1/notes',
    method: 'POST',
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
      return validateAndBuildNoteBody(params)
    },
  },
  directExecution: async (params: WealthboxWriteParams) => {
    // Validate access token
    if (!params.accessToken) {
      throw new Error('Access token is required')
    }

    const body = validateAndBuildNoteBody(params)

    const response = await fetch('https://api.crmworkspace.com/v1/notes', {
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
    return formatNoteResponse(data)
  },
  transformResponse: async (response: Response, params?: WealthboxWriteParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      handleApiError(response, errorText)
    }

    const data = await response.json()
    return formatNoteResponse(data)
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
    return 'An error occurred while writing Wealthbox note'
  },
}
