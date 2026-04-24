import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListCandidateTagsParams {
  apiKey: string
  includeArchived?: boolean
  cursor?: string
  syncToken?: string
  perPage?: number
}

interface AshbyCandidateTag {
  id: string
  title: string
  isArchived: boolean
}

interface AshbyListCandidateTagsResponse extends ToolResponse {
  output: {
    tags: AshbyCandidateTag[]
    moreDataAvailable: boolean
    nextCursor: string | null
    syncToken: string | null
  }
}

export const listCandidateTagsTool: ToolConfig<
  AshbyListCandidateTagsParams,
  AshbyListCandidateTagsResponse
> = {
  id: 'ashby_list_candidate_tags',
  name: 'Ashby List Candidate Tags',
  description: 'Lists all candidate tags configured in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include archived candidate tags (default false)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sync token from a previous response to fetch only changed results',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default 100)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidateTag.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.includeArchived !== undefined) body.includeArchived = params.includeArchived
      if (params.cursor) body.cursor = params.cursor
      if (params.syncToken) body.syncToken = params.syncToken
      if (params.perPage) body.limit = params.perPage
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list candidate tags')
    }

    return {
      success: true,
      output: {
        tags: (data.results ?? []).map((t: Record<string, unknown>) => ({
          id: (t.id as string) ?? '',
          title: (t.title as string) ?? '',
          isArchived: (t.isArchived as boolean) ?? false,
        })),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
        syncToken: data.syncToken ?? null,
      },
    }
  },

  outputs: {
    tags: {
      type: 'array',
      description: 'List of candidate tags',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Tag UUID' },
          title: { type: 'string', description: 'Tag title' },
          isArchived: { type: 'boolean', description: 'Whether the tag is archived' },
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
    syncToken: {
      type: 'string',
      description: 'Sync token to use for incremental updates in future requests',
      optional: true,
    },
  },
}
