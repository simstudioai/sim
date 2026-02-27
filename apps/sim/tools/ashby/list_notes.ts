import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListNotesParams {
  apiKey: string
  candidateId: string
  cursor?: string
  perPage?: number
}

interface AshbyListNotesResponse extends ToolResponse {
  output: {
    notes: Array<{
      id: string
      content: string
      author: {
        id: string
        firstName: string
        lastName: string
        email: string
      } | null
      createdAt: string
    }>
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export const listNotesTool: ToolConfig<AshbyListNotesParams, AshbyListNotesResponse> = {
  id: 'ashby_list_notes',
  name: 'Ashby List Notes',
  description: 'Lists all notes on a candidate with pagination support.',
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
      description: 'The UUID of the candidate to list notes for',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.listNotes',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        candidateId: params.candidateId,
      }
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list notes')
    }

    return {
      success: true,
      output: {
        notes: (data.results ?? []).map(
          (
            n: Record<string, unknown> & {
              author?: { id?: string; firstName?: string; lastName?: string; email?: string }
            }
          ) => ({
            id: n.id ?? null,
            content: n.content ?? null,
            author: n.author
              ? {
                  id: n.author.id ?? null,
                  firstName: n.author.firstName ?? null,
                  lastName: n.author.lastName ?? null,
                  email: n.author.email ?? null,
                }
              : null,
            createdAt: n.createdAt ?? null,
          })
        ),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    notes: {
      type: 'array',
      description: 'List of notes on the candidate',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Note UUID' },
          content: { type: 'string', description: 'Note content' },
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
      },
    },
    moreDataAvailable: {
      type: 'boolean',
      description: 'Whether more pages of results exist',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for fetching the next page',
      optional: true,
    },
  },
}
