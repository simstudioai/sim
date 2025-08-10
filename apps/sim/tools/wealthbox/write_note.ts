import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from '@/tools/wealthbox/types'

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
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created or updated note data and metadata',
      properties: {
        note: { type: 'object', description: 'Raw note data from Wealthbox' },
        success: { type: 'boolean', description: 'Operation success indicator' },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            operation: { type: 'string', description: 'The operation performed' },
            itemId: { type: 'string', description: 'ID of the created/updated note' },
            itemType: { type: 'string', description: 'Type of item (note)' },
          },
        },
      },
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
    const data = await response.json()
    return formatNoteResponse(data)
  },
  transformError: (error: Error) => {
    return `Wealthbox API Error: ${error.message || 'Unknown error'}`
  },
}
