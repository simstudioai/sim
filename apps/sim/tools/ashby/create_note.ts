import type { ToolConfig } from '@/tools/types'
import type { AshbyCreateNoteParams, AshbyCreateNoteResponse } from './types'

export const createNoteTool: ToolConfig<AshbyCreateNoteParams, AshbyCreateNoteResponse> = {
  id: 'ashby_create_note',
  name: 'Ashby Create Note',
  description:
    'Creates a note on a candidate in Ashby. Supports plain text and HTML content (bold, italic, underline, links, lists, code).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the candidate to add the note to',
    },
    note: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The note content. If noteType is text/html, supports: <b>, <i>, <u>, <a>, <ul>, <ol>, <li>, <code>, <pre>',
    },
    noteType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content type of the note: text/plain (default) or text/html',
    },
    sendNotifications: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send notifications to subscribed users (default false)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.createNote',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        candidateId: params.candidateId,
        sendNotifications: params.sendNotifications ?? false,
      }
      if (params.noteType === 'text/html') {
        body.note = {
          type: 'text/html',
          value: params.note,
        }
      } else {
        body.note = params.note
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to create note')
    }

    const r = data.results

    return {
      success: true,
      output: {
        id: r.id ?? null,
        content: r.content ?? null,
        author: r.author
          ? {
              id: r.author.id ?? null,
              firstName: r.author.firstName ?? null,
              lastName: r.author.lastName ?? null,
              email: r.author.email ?? null,
            }
          : null,
        createdAt: r.createdAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created note UUID' },
    content: { type: 'string', description: 'Note content as stored' },
    author: {
      type: 'object',
      description: 'Note author',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Author user UUID' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        email: { type: 'string', description: 'Email address' },
      },
    },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
  },
}
