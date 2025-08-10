import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import type { WealthboxReadParams, WealthboxReadResponse } from '@/tools/wealthbox/types'

const logger = createLogger('WealthboxReadNote')

export const wealthboxReadNoteTool: ToolConfig<WealthboxReadParams, WealthboxReadResponse> = {
  id: 'wealthbox_read_note',
  name: 'Read Wealthbox Note',
  description: 'Read content from a Wealthbox note',
  version: '1.0.0',

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
    const data = await response.json()

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

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Note data and metadata',
      properties: {
        content: { type: 'string', description: 'Formatted note information' },
        note: { type: 'object', description: 'Raw note data from Wealthbox' },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            operation: { type: 'string', description: 'The operation performed' },
            noteId: { type: 'string', description: 'ID of the note' },
            itemType: { type: 'string', description: 'Type of item (note)' },
          },
        },
      },
    },
  },
}
