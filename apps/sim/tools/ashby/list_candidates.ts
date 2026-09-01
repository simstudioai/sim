import type { AshbyListCandidatesParams, AshbyListCandidatesResponse } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  ashbyLimit,
  ashbyTimestamp,
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
    createdBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates created before this ISO 8601 timestamp',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token from a completed prior sync run',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      const limit = ashbyLimit(params.perPage)
      if (limit) body.limit = limit
      if (params.syncToken) body.syncToken = params.syncToken
      if (params.createdAfter)
        body.createdAfter = ashbyTimestamp(params.createdAfter, 'createdAfter')
      if (params.createdBefore)
        body.createdBefore = ashbyTimestamp(params.createdBefore, 'createdBefore')
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
        nextSyncCursor: data.syncToken ?? null,
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
    nextSyncCursor: {
      type: 'string',
      description: 'Opaque token for the next incremental sync, returned on the final page',
      optional: true,
    },
  },
}
