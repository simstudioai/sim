import { toArray } from '@sim/utils/object'
import type {
  PiloterrAmazonProduct,
  PiloterrAmazonSearchParams,
  PiloterrAmazonSearchResponse,
} from '@/tools/piloterr/types'
import { PILOTERR_AMAZON_PRODUCT_OUTPUT_PROPERTIES } from '@/tools/piloterr/types'
import { mapPiloterrAmazonProduct } from '@/tools/piloterr/utils'
import type { ToolConfig } from '@/tools/types'

export const piloterrAmazonSearchTool: ToolConfig<
  PiloterrAmazonSearchParams,
  PiloterrAmazonSearchResponse
> = {
  id: 'piloterr_amazon_search',
  name: 'Piloterr Amazon Search',
  description:
    'Search an Amazon marketplace and get products with ASIN, title, price, rating and review count.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Keyword or phrase to search for (e.g., "playstation 5")',
    },
    marketplace: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Amazon domain extension of the marketplace (e.g., "com", "fr", "co.uk"; defaults to "com")',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page of results, starting at 1',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Piloterr API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.piloterr.com/v2/amazon/search`)
      url.searchParams.set('query', params.query.trim())
      if (params.marketplace?.trim()) url.searchParams.set('domain', params.marketplace.trim())
      if (params.page != null) url.searchParams.set('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const items = toArray(await response.json())
    return {
      success: true,
      output: {
        products: items
          .map(mapPiloterrAmazonProduct)
          .filter((item): item is PiloterrAmazonProduct => item !== null),
      },
    }
  },

  outputs: {
    products: {
      type: 'array',
      description: 'Products found on Amazon',
      optional: true,
      items: { type: 'object', properties: PILOTERR_AMAZON_PRODUCT_OUTPUT_PROPERTIES },
    },
  },
}
