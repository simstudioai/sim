import type { AshbyListCandidatesParams, AshbyListCandidatesResponse } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  CANDIDATE_OUTPUTS,
  mapCandidate,
} from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

export const listCandidatesTool: ToolConfig<
  AshbyListCandidatesParams,
  AshbyListCandidatesResponse
> = {
  id: 'ashby_list_candidates',
  name: 'Ashby List Candidates',
  description: 'Lists all candidates in an Ashby organization with cursor-based pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
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
      description: 'Number of results per page (default 100)',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return candidates created after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      if (params.createdAfter) {
        const ms = new Date(params.createdAfter).getTime()
        if (!Number.isNaN(ms)) body.createdAfter = ms
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to list candidates'))
    }

    return {
      success: true,
      output: {
        candidates: (data.results ?? []).map(mapCandidate),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    candidates: {
      type: 'array',
      description: 'List of candidates',
      items: {
        type: 'object',
        properties: CANDIDATE_OUTPUTS,
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
