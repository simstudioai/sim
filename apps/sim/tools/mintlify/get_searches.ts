import type {
  MintlifyGetSearchesParams,
  MintlifyGetSearchesResponse,
  MintlifySearchQueryRow,
} from '@/tools/mintlify/types'
import {
  appendParam,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableNumber,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

function toSearchRows(value: unknown): MintlifySearchQueryRow[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    return {
      searchQuery: toNullableString(row.searchQuery),
      hits: toNullableNumber(row.hits),
      ctr: toNullableNumber(row.ctr),
      topClickedPage: toNullableString(row.topClickedPage),
      lastSearchedAt: toNullableString(row.lastSearchedAt),
    }
  })
}

export const mintlifyGetSearchesTool: ToolConfig<
  MintlifyGetSearchesParams,
  MintlifyGetSearchesResponse
> = {
  id: 'mintlify_get_searches',
  name: 'Mintlify Get Search Queries',
  description:
    'Export Mintlify documentation search terms for a date range, ordered by hit count, with click-through rate and the most-clicked result path.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    dateFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inclusive start date in ISO 8601 or YYYY-MM-DD format',
    },
    dateTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive end date in ISO 8601 or YYYY-MM-DD format',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max search terms per page, between 1 and 100 (default 50)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor returned as nextCursor by a previous call',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${MINTLIFY_API_BASE}/v1/analytics/${pathSegment(params.projectId)}/searches`
      )
      appendParam(url, 'dateFrom', params.dateFrom)
      appendParam(url, 'dateTo', params.dateTo)
      appendParam(url, 'limit', params.limit)
      appendParam(url, 'cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify search queries')

    return {
      success: true,
      output: {
        searches: toSearchRows(data.searches),
        totalSearches: toNullableNumber(data.totalSearches),
        nextCursor: toNullableString(data.nextCursor),
      },
    }
  },

  outputs: {
    searches: {
      type: 'array',
      description: 'Search terms ordered by hit count descending',
      items: {
        type: 'object',
        properties: {
          searchQuery: {
            type: 'string',
            description: 'The search term entered by users',
            nullable: true,
          },
          hits: {
            type: 'number',
            description: 'Number of times this term was searched',
            nullable: true,
          },
          ctr: {
            type: 'number',
            description: 'Click-through rate for this search term',
            nullable: true,
          },
          topClickedPage: {
            type: 'string',
            description: 'Most-clicked result path for this query',
            nullable: true,
          },
          lastSearchedAt: {
            type: 'string',
            description: 'Timestamp of the last time this term was searched',
            nullable: true,
          },
        },
      },
    },
    totalSearches: {
      type: 'number',
      description:
        'Total search events in the date range, summing all hits rather than distinct queries',
      nullable: true,
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null when there are no more results',
      nullable: true,
    },
  },
}
