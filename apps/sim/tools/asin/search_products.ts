import { toArray, toRecord } from '@sim/utils/object'
import type {
  AsinSearchProductsParams,
  AsinSearchProductsResponse,
  AsinSearchResult,
} from '@/tools/asin/types'
import { ASIN_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/asin/types'
import { mapAsinSearchResult } from '@/tools/asin/utils'
import type { ToolConfig } from '@/tools/types'

export const asinSearchProductsTool: ToolConfig<
  AsinSearchProductsParams,
  AsinSearchProductsResponse
> = {
  id: 'asin_search_products',
  name: 'Asin Search Products',
  description:
    'Search an Amazon store and get up to 60 results, sponsored ones included, with ASIN, title, price, rating and review count.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search terms (e.g., "wireless earbuds")',
    },
    marketplace: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Amazon store: com, co.uk, de, fr, it, es, ca, co.jp, com.br, com.mx or in (defaults to "com")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Asin API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://www.asin.dev/api/v1/search`)
      url.searchParams.set('query', params.query.trim())
      if (params.marketplace?.trim()) url.searchParams.set('marketplace', params.marketplace.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        results: toArray(data.results)
          .map(mapAsinSearchResult)
          .filter((item): item is AsinSearchResult => item !== null),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Products found on Amazon',
      optional: true,
      items: { type: 'object', properties: ASIN_SEARCH_RESULT_OUTPUT_PROPERTIES },
    },
  },
}
