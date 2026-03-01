import type { PagerDutyAddNoteParams, PagerDutyAddNoteResponse } from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const addNoteTool: ToolConfig<PagerDutyAddNoteParams, PagerDutyAddNoteResponse> = {
  id: 'pagerduty_add_note',
  name: 'PagerDuty Add Note',
  description: 'Add a note to an existing PagerDuty incident.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    fromEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of a valid PagerDuty user',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the incident to add the note to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Note content text',
    },
  },

  request: {
    url: (params) => `https://api.pagerduty.com/incidents/${params.incidentId.trim()}/notes`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Token token=${params.apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
      From: params.fromEmail,
    }),
    body: (params) => ({
      note: {
        content: params.content,
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `PagerDuty API error: ${response.status}`)
    }

    const note = data.note ?? {}
    return {
      success: true,
      output: {
        id: note.id ?? null,
        content: note.content ?? null,
        createdAt: note.created_at ?? null,
        userName: note.user?.summary ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Note ID' },
    content: { type: 'string', description: 'Note content' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    userName: { type: 'string', description: 'Name of the user who created the note' },
  },
}
