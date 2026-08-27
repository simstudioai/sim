import {
  RUN_SUMMARY_OUTPUT_PROPERTIES,
  type TinyFishListRunsParams,
  type TinyFishListRunsResponse,
} from '@/tools/tinyfish/types'
import {
  mapRunSummary,
  TINYFISH_AGENT_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

export const listRunsTool: ToolConfig<TinyFishListRunsParams, TinyFishListRunsResponse> = {
  id: 'tinyfish_list_runs',
  name: 'TinyFish List Runs',
  description:
    'List TinyFish automation runs, optionally filtered by status, goal text, or creation date',
  version: '1.0.0',

  params: {
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by run status: PENDING, RUNNING, COMPLETED, FAILED, or CANCELLED',
    },
    goal: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by goal text (case-insensitive partial match, max 500 characters)',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return runs created after this ISO 8601 timestamp',
    },
    createdBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return runs created before this ISO 8601 timestamp',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by creation time: "desc" (newest first, default) or "asc"',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum runs to return (1-100, default 20)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned by a previous call',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'TinyFish API key',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.status) query.set('status', params.status)
      if (params.goal) query.set('goal', params.goal)
      if (params.createdAfter) query.set('created_after', params.createdAfter)
      if (params.createdBefore) query.set('created_before', params.createdBefore)
      if (params.sortDirection) query.set('sort_direction', params.sortDirection)
      if (params.cursor) query.set('cursor', params.cursor)
      if (typeof params.limit === 'number' && Number.isFinite(params.limit)) {
        query.set('limit', String(params.limit))
      }

      const search = query.toString()
      return `${TINYFISH_AGENT_API_BASE}/v1/runs${search ? `?${search}` : ''}`
    },
    method: 'GET',
    headers: (params) => tinyfishHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        runs: Array.isArray(data.data) ? data.data.map(mapRunSummary) : [],
        total: data.pagination?.total ?? 0,
        nextCursor: data.pagination?.next_cursor ?? null,
        hasMore: data.pagination?.has_more ?? false,
      },
    }
  },

  outputs: {
    runs: {
      type: 'array',
      description: 'Runs matching the filters, newest first by default',
      items: {
        type: 'object',
        properties: RUN_SUMMARY_OUTPUT_PROPERTIES,
      },
    },
    total: { type: 'number', description: 'Total runs matching the filters' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, null when there are no more results',
      optional: true,
    },
    hasMore: { type: 'boolean', description: 'Whether more results follow this page' },
  },
}
