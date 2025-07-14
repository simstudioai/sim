import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { WealthboxReadParams, WealthboxReadResponse } from './types'

const logger = createLogger('WealthboxReadNote')

export const wealthboxReadNoteTool: ToolConfig<WealthboxReadParams, WealthboxReadResponse> = {
  id: 'wealthbox_read_note',
  name: 'Read Wealthbox Note',
  description: 'Read content from a Wealthbox note',
  version: '1.1',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
      visibility: 'hidden',
    },
    noteId: {
      type: 'string',
      required: false,
      description: 'The ID of the note to read',
      visibility: 'user-only',
    },
  },
  request: {
    url: (params) => {
      const noteId = params.noteId?.trim()
      let url = 'https://api.crmworkspace.com/v1/notes'
      if (noteId) {
        url = `https://api.crmworkspace.com/v1/notes/${noteId}`
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
      logger.error(`Wealthbox note API error: ${response.status} ${response.statusText}`, errorText)

      // Provide more specific error messages
      if (response.status === 404) {
        throw new Error(
          `Note with ID ${params?.noteId} not found. Please check the note ID and try again.`
        )
      }
      if (response.status === 403) {
        throw new Error(
          `Access denied to note with ID ${params?.noteId}. Please check your permissions.`
        )
      }
      throw new Error(
        `Failed to read Wealthbox note: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data = await response.json()

    if (!data) {
      return {
        success: false,
        output: {
          note: undefined,
          metadata: {
            operation: 'read_note' as const,
            noteId: params?.noteId || '',
            itemType: 'note' as const,
          },
        },
      }
    }

    // Format note information into readable content
    const note = data
    let content = `Note Content: ${note.content || 'No content available'}`

    if (note.created_at) {
      content += `\nCreated: ${new Date(note.created_at).toLocaleString()}`
    }

    if (note.updated_at) {
      content += `\nUpdated: ${new Date(note.updated_at).toLocaleString()}`
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
        metadata: {
          operation: 'read_note' as const,
          noteId: params?.noteId || note.id?.toString() || '',
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
    return 'An error occurred while reading Wealthbox note'
  },
}
