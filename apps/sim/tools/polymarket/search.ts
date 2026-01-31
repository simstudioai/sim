import type { PolymarketSearchResult } from '@/tools/polymarket/types'
import { buildGammaUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketSearchParams {
  query: string
  limit?: string
  page?: string
  cache?: string
  eventsStatus?: string
  limitPerType?: string
  eventsTag?: string
  sort?: string
  ascending?: string
  searchTags?: string
  searchProfiles?: string
  recurrence?: string
  excludeTagId?: string
  keepClosedMarkets?: string
}

export interface PolymarketSearchResponse {
  success: boolean
  output: {
    results: PolymarketSearchResult
  }
}

export const polymarketSearchTool: ToolConfig<PolymarketSearchParams, PolymarketSearchResponse> = {
  id: 'polymarket_search',
  name: 'Search Polymarket',
  description: 'Search for markets, events, and profiles on Polymarket',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      description: 'Search query term (e.g., "presidential election", "bitcoin price").',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results per page (e.g., "25"). Max: 50.',
      visibility: 'user-or-llm',
    },
    page: {
      type: 'string',
      required: false,
      description: 'Page number for pagination (e.g., "2"). 1-indexed.',
      visibility: 'user-or-llm',
    },
    cache: {
      type: 'string',
      required: false,
      description: 'Enable caching (true/false)',
      visibility: 'user-or-llm',
    },
    eventsStatus: {
      type: 'string',
      required: false,
      description: 'Filter events by status',
      visibility: 'user-or-llm',
    },
    limitPerType: {
      type: 'string',
      required: false,
      description: 'Limit results per type (markets, events, profiles)',
      visibility: 'user-or-llm',
    },
    eventsTag: {
      type: 'string',
      required: false,
      description: 'Filter by event tags (comma-separated)',
      visibility: 'user-or-llm',
    },
    sort: {
      type: 'string',
      required: false,
      description: 'Sort field',
      visibility: 'user-or-llm',
    },
    ascending: {
      type: 'string',
      required: false,
      description: 'Sort direction (true for ascending, false for descending)',
      visibility: 'user-or-llm',
    },
    searchTags: {
      type: 'string',
      required: false,
      description: 'Include tags in search results (true/false)',
      visibility: 'user-or-llm',
    },
    searchProfiles: {
      type: 'string',
      required: false,
      description: 'Include profiles in search results (true/false)',
      visibility: 'user-or-llm',
    },
    recurrence: {
      type: 'string',
      required: false,
      description: 'Filter by recurrence type',
      visibility: 'user-or-llm',
    },
    excludeTagId: {
      type: 'string',
      required: false,
      description: 'Exclude events with these tag IDs (comma-separated)',
      visibility: 'user-or-llm',
    },
    keepClosedMarkets: {
      type: 'string',
      required: false,
      description: 'Include closed markets in results (0 or 1)',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('q', params.query)
      queryParams.append('limit', params.limit || '50')
      if (params.page) queryParams.append('page', params.page)
      if (params.cache) queryParams.append('cache', params.cache)
      if (params.eventsStatus) queryParams.append('events_status', params.eventsStatus)
      if (params.limitPerType) queryParams.append('limit_per_type', params.limitPerType)
      if (params.eventsTag) queryParams.append('events_tag', params.eventsTag)
      if (params.sort) queryParams.append('sort', params.sort)
      if (params.ascending) queryParams.append('ascending', params.ascending)
      if (params.searchTags) queryParams.append('search_tags', params.searchTags)
      if (params.searchProfiles) queryParams.append('search_profiles', params.searchProfiles)
      if (params.recurrence) queryParams.append('recurrence', params.recurrence)
      if (params.excludeTagId) queryParams.append('exclude_tag_id', params.excludeTagId)
      if (params.keepClosedMarkets)
        queryParams.append('keep_closed_markets', params.keepClosedMarkets)

      return `${buildGammaUrl('/public-search')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'search')
    }

    const results: PolymarketSearchResult = {
      markets: data.markets ?? [],
      events: data.events ?? [],
      tags: data.tags ?? [],
      profiles: data.profiles ?? [],
    }

    return {
      success: true,
      output: {
        results,
      },
    }
  },

  outputs: {
    results: {
      type: 'object',
      description: 'Search results containing markets, events, tags, and profiles arrays',
      properties: {
        markets: { type: 'array', description: 'Array of matching market objects' },
        events: { type: 'array', description: 'Array of matching event objects' },
        tags: { type: 'array', description: 'Array of matching tag objects' },
        profiles: { type: 'array', description: 'Array of matching profile objects' },
      },
    },
  },
}
