import type { GranolaListNotesParams, GranolaListNotesResponse } from '@/tools/granola/types'
import type { ToolConfig } from '@/tools/types'

export const listNotesTool: ToolConfig<GranolaListNotesParams, GranolaListNotesResponse> = {
  id: 'granola_list_notes',
  name: 'Granola List Notes',
  description: 'Lists meeting notes from Granola with optional date filters and pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Granola API key',
    },
    createdBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return notes created before this date (ISO 8601)',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return notes created after this date (ISO 8601)',
    },
    updatedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return notes updated after this date (ISO 8601)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of notes per page (1-30, default 10)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.granola.ai/v1/notes')
      if (params.createdBefore) url.searchParams.append('created_before', params.createdBefore)
      if (params.createdAfter) url.searchParams.append('created_after', params.createdAfter)
      if (params.updatedAfter) url.searchParams.append('updated_after', params.updatedAfter)
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      if (params.pageSize) url.searchParams.append('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Granola API error (${response.status}): ${error}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        notes: (data.notes ?? []).map(
          (note: {
            id: string
            title: string | null
            owner: { name: string | null; email: string }
            created_at: string
            updated_at: string
          }) => ({
            id: note.id,
            title: note.title ?? null,
            ownerName: note.owner?.name ?? null,
            ownerEmail: note.owner?.email ?? '',
            createdAt: note.created_at ?? '',
            updatedAt: note.updated_at ?? '',
          })
        ),
        hasMore: data.hasMore ?? false,
        cursor: data.cursor ?? null,
      },
    }
  },

  outputs: {
    notes: {
      type: 'json',
      description: 'List of meeting notes',
      properties: {
        id: { type: 'string', description: 'Note ID' },
        title: { type: 'string', description: 'Note title' },
        ownerName: { type: 'string', description: 'Note owner name' },
        ownerEmail: { type: 'string', description: 'Note owner email' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more notes are available',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
