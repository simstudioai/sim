import type {
  WealthboxTaskRequestBody,
  WealthboxWriteParams,
  WealthboxWriteResponse,
} from './types'

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

// Utility function to validate parameters and build contact body
export const validateAndBuildContactBody = (params: WealthboxWriteParams): Record<string, any> => {
  // Validate required fields with safe stringification
  const firstName = safeStringify(params.firstName).trim()
  const lastName = safeStringify(params.lastName).trim()

  if (!firstName) {
    throw new Error('First name is required')
  }
  if (!lastName) {
    throw new Error('Last name is required')
  }

  const body: Record<string, any> = {
    first_name: firstName,
    last_name: lastName,
  }

  // Add optional fields with safe stringification
  const emailAddress = safeStringify(params.emailAddress).trim()
  if (emailAddress) {
    body.email_addresses = [
      {
        address: emailAddress,
        kind: 'email',
        principal: true,
      },
    ]
  }

  const backgroundInformation = safeStringify(params.backgroundInformation).trim()
  if (backgroundInformation) {
    body.background_information = backgroundInformation
  }

  return body
}

export // Utility function to validate parameters and build note body
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
export const handleApiError = (response: Response, errorText: string): never => {
  throw new Error(
    `Failed to create Wealthbox note: ${response.status} ${response.statusText} - ${errorText}`
  )
}

// Utility function to format note response
export const formatNoteResponse = (data: any): WealthboxWriteResponse => {
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

export const formatTaskResponse = (
  data: any,
  params?: WealthboxWriteParams
): WealthboxWriteResponse => {
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

export // Utility function to validate parameters and build task body
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
