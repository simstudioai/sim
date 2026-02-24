import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateNoteParams, AttioCreateNoteResponse } from './types'
import { NOTE_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioCreateNote')

export const attioCreateNoteTool: ToolConfig<AttioCreateNoteParams, AttioCreateNoteResponse> = {
  id: 'attio_create_note',
  name: 'Attio Create Note',
  description: 'Create a note on a record in Attio',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'The parent object type slug (e.g. people, companies)',
    },
    parentRecordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The parent record ID to attach the note to',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The note title',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The note content',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content format: plaintext or markdown (default plaintext)',
    },
    createdAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Backdate the note creation time (ISO 8601 format)',
    },
    meetingId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Associate the note with a meeting ID',
    },
  },

  request: {
    url: 'https://api.attio.com/v2/notes',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        parent_object: params.parentObject,
        parent_record_id: params.parentRecordId,
        title: params.title,
        format: params.format || 'plaintext',
        content: params.content,
      }
      if (params.createdAt) body.created_at = params.createdAt
      if (params.meetingId !== undefined) body.meeting_id = params.meetingId || null
      return { data: body }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create note')
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
