import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  PiloterrEbayListing,
  PiloterrEbaySearchParams,
  PiloterrEbaySearchResponse,
} from '@/tools/piloterr/types'
import { PILOTERR_EBAY_LISTING_OUTPUT_PROPERTIES } from '@/tools/piloterr/types'
import { mapPiloterrEbayListing } from '@/tools/piloterr/utils'
import type { ToolConfig } from '@/tools/types'

export const piloterrEbaySearchTool: ToolConfig<
  PiloterrEbaySearchParams,
  PiloterrEbaySearchResponse
> = {
  id: 'piloterr_ebay_search',
  name: 'Piloterr eBay Search',
  description:
    'Search eBay listings by keyword or search URL and get their price, condition, buying format, shipping and seller.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Keyword on ebay.com, or a search URL on a supported eBay site (e.g., "laptop")',
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
      const url = new URL(`https://api.piloterr.com/v2/ebay/search`)
      url.searchParams.set('query', params.query.trim())
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
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        listings: toArray(data.results)
          .map(mapPiloterrEbayListing)
          .filter((item): item is PiloterrEbayListing => item !== null),
        nextPageUrl: toStringOrNull(toRecord(data.pagination).next),
        page: toNumberOrNull(toRecord(data.pagination).page),
      },
    }
  },

  outputs: {
    listings: {
      type: 'array',
      description: 'Listings found on eBay',
      optional: true,
      items: { type: 'object', properties: PILOTERR_EBAY_LISTING_OUTPUT_PROPERTIES },
    },
    nextPageUrl: {
      type: 'string',
      description: 'URL of the next page of results',
      optional: true,
    },
    page: {
      type: 'number',
      description: 'Current page',
      optional: true,
    },
  },
}
