import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetNoteParams, AttioGetNoteResponse } from './types'
import { NOTE_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetNote')

export const attioGetNoteTool: ToolConfig<AttioGetNoteParams, AttioGetNoteResponse> = {
  id: 'attio_get_note',
  name: 'Attio Get Note',
  description: 'Get a single note by ID from Attio',
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
    noteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the note to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/notes/${params.noteId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get note')
    }
    const note = data.data
    return {
      success: true,
      output: {
        noteId: note.id?.note_id ?? null,
        parentObject: note.parent_object ?? null,
        parentRecordId: note.parent_record_id ?? null,
        title: note.title ?? null,
        contentPlaintext: note.content_plaintext ?? null,
        contentMarkdown: note.content_markdown ?? null,
        meetingId: note.meeting_id ?? null,
        tags: note.tags ?? [],
        createdByActor: note.created_by_actor ?? null,
        createdAt: note.created_at ?? null,
      },
    }
  },

  outputs: NOTE_OUTPUT_PROPERTIES,
}
