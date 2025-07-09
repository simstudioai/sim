import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { WealthboxWriteParams, WealthboxWriteResponse } from './types'

const logger = createLogger('WealthboxWriteNote')

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
    },
    content: {
      type: 'string',
      required: true,
      description: 'The main body of the note',
    },
    contactId: {
      type: 'string',
      required: false,
      description: 'ID of contact to link to this note',
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
      // Validate required fields
      if (!params.content?.trim()) {
        throw new Error('Note content is required')
      }

      const body: Record<string, any> = {
        content: params.content.trim(),
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
    // Validate access token
    if (!params.accessToken) {
      throw new Error('Access token is required')
    }

    // Validate required fields
    if (!params.content?.trim()) {
      throw new Error('Note content is required')
    }

    const body: Record<string, any> = {
      content: params.content.trim(),
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

    const response = await fetch('https://api.wealthbox.com/v1/notes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Wealthbox note write API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to create Wealthbox note: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: true,
        output: {
          note: undefined,
          metadata: {
            operation: 'write_note' as const,
            itemType: 'note' as const,
          },
        },
      }
    }

    // Format note information into readable content
    const note = data
    let content = `Note created: ${note.content ? note.content.substring(0, 100) + (note.content.length > 100 ? '...' : '') : 'No content'}`

    if (note.created_at) {
      content += `\nCreated: ${new Date(note.created_at).toLocaleString()}`
    }

    if (note.visible_to) {
      content += `\nVisible to: ${note.visible_to}`
    }

    if (note.linked_to && note.linked_to.length > 0) {
      content += '\nLinked to:'
      note.linked_to.forEach((link: any) => {
        content += `\n  - ${link.name} (${link.type})`
      })
    }

    if (note.tags && note.tags.length > 0) {
      content += '\nTags:'
      note.tags.forEach((tag: any) => {
        content += `\n  - ${tag.name}`
      })
    }

    return {
      success: true,
      output: {
        content,
        note,
        success: true,
        metadata: {
          operation: 'write_note' as const,
          noteId: note.id?.toString() || '',
          itemType: 'note' as const,
        },
      },
    }
  },
  transformResponse: async (response: Response, params?: WealthboxWriteParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Wealthbox note write API error: ${response.status} ${response.statusText}`,
        errorText
      )
      throw new Error(
        `Failed to create Wealthbox note: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: true,
        output: {
          note: undefined,
          metadata: {
            operation: 'write_note' as const,
            itemType: 'note' as const,
          },
        },
      }
    }

    // Format note information into readable content
    const note = data
    let content = `Note created: ${note.content ? note.content.substring(0, 100) + (note.content.length > 100 ? '...' : '') : 'No content'}`

    if (note.created_at) {
      content += `\nCreated: ${new Date(note.created_at).toLocaleString()}`
    }

    if (note.visible_to) {
      content += `\nVisible to: ${note.visible_to}`
    }

    if (note.linked_to && note.linked_to.length > 0) {
      content += '\nLinked to:'
      note.linked_to.forEach((link: any) => {
        content += `\n  - ${link.name} (${link.type})`
      })
    }

    if (note.tags && note.tags.length > 0) {
      content += '\nTags:'
      note.tags.forEach((tag: any) => {
        content += `\n  - ${tag.name}`
      })
    }

    return {
      success: true,
      output: {
        content,
        note,
        success: true,
        metadata: {
          operation: 'write_note' as const,
          noteId: note.id?.toString() || '',
          itemType: 'note' as const,
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
    return 'An error occurred while writing Wealthbox note'
  },
}
