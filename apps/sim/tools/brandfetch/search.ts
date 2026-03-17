import type {
  BrandfetchSearchParams,
  BrandfetchSearchResponse,
  BrandfetchSearchResult,
} from '@/tools/brandfetch/types'
import type { ToolConfig } from '@/tools/types'

export const brandfetchSearchTool: ToolConfig<BrandfetchSearchParams, BrandfetchSearchResponse> = {
  id: 'brandfetch_search',
  name: 'Brandfetch Search',
  description: 'Search for brands by name and find their domains and logos',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'BRANDFETCH_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'brandfetch',
    pricing: {
      type: 'per_request',
      // Brand Search API is free (fair-use 500K/month) — https://docs.brandfetch.com/brand-search-api/rate-limits
      cost: 0,
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 30,
    },
  },

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brandfetch API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company or brand name to search for',
    },
  },

  request: {
    url: (params) =>
      `https://api.brandfetch.io/v2/search/${encodeURIComponent(params.name.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Brandfetch API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const results = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        results: results.map((item: Partial<BrandfetchSearchResult>) => ({
          brandId: item.brandId ?? '',
          name: item.name ?? null,
          domain: item.domain ?? '',
          claimed: item.claimed ?? false,
          icon: item.icon ?? null,
        })),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'List of matching brands',
      items: {
        type: 'json',
        properties: {
          brandId: { type: 'string', description: 'Unique brand identifier' },
          name: { type: 'string', description: 'Brand name' },
          domain: { type: 'string', description: 'Brand domain' },
          claimed: { type: 'boolean', description: 'Whether the brand profile is claimed' },
          icon: { type: 'string', description: 'Brand icon URL' },
        },
      },
    },
  },
}
