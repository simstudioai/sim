import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListNotesParams, AttioListNotesResponse } from './types'
import { NOTE_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioListNotes')

export const attioListNotesTool: ToolConfig<AttioListNotesParams, AttioListNotesResponse> = {
  id: 'attio_list_notes',
  name: 'Attio List Notes',
  description: 'List notes in Attio, optionally filtered by parent record',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
    parentObject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object type slug to filter notes by (e.g. people, companies)',
    },
    parentRecordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Record ID to filter notes by',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of notes to return (default 10, max 50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of notes to skip for pagination',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.parentObject) searchParams.set('parent_object', params.parentObject)
      if (params.parentRecordId) searchParams.set('parent_record_id', params.parentRecordId)
      if (params.limit != null) searchParams.set('limit', String(params.limit))
      if (params.offset != null) searchParams.set('offset', String(params.offset))
      const qs = searchParams.toString()
      return `https://api.attio.com/v2/notes${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list notes')
    }
    const notes = (data.data ?? []).map((note: Record<string, unknown>) => {
      const noteId = note.id as { note_id?: string } | undefined
      return {
        noteId: noteId?.note_id ?? null,
        parentObject: (note.parent_object as string) ?? null,
        parentRecordId: (note.parent_record_id as string) ?? null,
        title: (note.title as string) ?? null,
        contentPlaintext: (note.content_plaintext as string) ?? null,
        contentMarkdown: (note.content_markdown as string) ?? null,
        meetingId: (note.meeting_id as string) ?? null,
        tags: (note.tags as unknown[]) ?? [],
        createdByActor: note.created_by_actor ?? null,
        createdAt: (note.created_at as string) ?? null,
      }
    })
    return {
      success: true,
      output: {
        notes,
        count: notes.length,
      },
    }
  },

  outputs: {
    notes: {
      type: 'array',
      description: 'Array of notes',
      items: {
        type: 'object',
        properties: NOTE_OUTPUT_PROPERTIES,
      },
    },
    count: { type: 'number', description: 'Number of notes returned' },
  },
}
