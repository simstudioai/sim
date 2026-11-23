import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import type { WealthboxReadParams, WealthboxReadResponse } from '@/tools/wealthbox/types'

export const wealthboxReadNoteTool: ToolConfig<WealthboxReadParams, WealthboxReadResponse> = {
  id: 'wealthbox_read_note',
  name: 'Read Wealthbox Note',
  description: 'Read content from a Wealthbox note',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'wealthbox',
  },

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
      description: 'The ID of the note to read (e.g., "11111")',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const noteId = params.noteId
      if (noteId == null || (typeof noteId === 'string' && !noteId.trim())) {
        return 'https://api.crmworkspace.com/v1/notes'
      }
      return `https://api.crmworkspace.com/v1/notes/${safeUrlPathSegment(noteId, 'noteId')}`
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

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const listed = Array.isArray(data?.status_updates) ? data.status_updates : undefined

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
        ...(listed ? { notes: listed } : {}),
        metadata: {
          itemId: note.id?.toString() ?? null,
          noteId: note.id?.toString() ?? null,
          itemType: 'note' as const,
          ...(listed ? { totalItems: listed.length } : {}),
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
        notes: {
          type: 'array',
          description: 'Notes in the returned page when no ID is given (list request)',
          optional: true,
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            itemId: { type: 'string', description: 'ID of the note', optional: true },
            noteId: { type: 'string', description: 'ID of the note', optional: true },
            totalItems: {
              type: 'number',
              description: 'Number of items in the returned page (list requests only)',
              optional: true,
            },
            itemType: { type: 'string', description: 'Type of item (note)' },
          },
        },
      },
    },
  },
}
