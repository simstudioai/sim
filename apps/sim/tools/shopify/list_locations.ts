import type { ShopifyListLocationsParams, ShopifyLocationsResponse } from '@/tools/shopify/types'
import { LOCATION_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyListLocationsTool: ToolConfig<
  ShopifyListLocationsParams,
  ShopifyLocationsResponse
> = {
  id: 'shopify_list_locations',
  name: 'Shopify List Locations',
  description:
    'List inventory locations from your Shopify store. Use this to find location IDs needed for inventory operations.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'shopify',
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
    reverse: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reverse the result sort order (default false)',
    },
    sortKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort results by ID, NAME, RELEVANCE (default Shopify ordering)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Shopify location search query, e.g. name:Warehouse',
    },
    includeLegacy: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include legacy fulfillment-service locations (default false)',
    },

    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Shopify Admin API token supplied by the connected credential',
    },
    shopDomain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Your Shopify store domain (e.g., mystore.myshopify.com)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from pageInfo.endCursor to retrieve the next page',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of locations to return (default: 50, max: 250)',
    },
    includeInactive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include deactivated locations (default: false)',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      const first = getShopifyPageSize(params.first, 250)

      return {
        query: `
          query listLocations($first: Int!, $after: String, $includeInactive: Boolean, $reverse: Boolean, $sortKey: LocationSortKeys, $query: String, $includeLegacy: Boolean) {
            locations(
              first: $first
              after: $after
              includeInactive: $includeInactive
              reverse: $reverse
              sortKey: $sortKey
              query: $query
              includeLegacy: $includeLegacy
            ) {
              edges {
                node {
                  id
                  name
                  isActive
                  fulfillsOnlineOrders
                  address {
                    address1
                    address2
                    city
                    province
                    provinceCode
                    country
                    countryCode
                    zip
                    phone
                  }
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
            }
          }

        `,
        variables: {
          reverse: params.reverse ?? false,
          sortKey: params.sortKey || undefined,
          query: params.query?.trim() || null,
          includeLegacy: params.includeLegacy ?? false,

          first,
          after: params.after?.trim() || null,
          includeInactive: params.includeInactive || false,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to list locations',
        output: {},
      }
    }

    const locationsData = data.data?.locations
    if (!locationsData) {
      return {
        success: false,
        error: 'Failed to retrieve locations',
        output: {},
      }
    }

    const locations = locationsData.edges.map((edge: { node: unknown }) => edge.node)

    return {
      success: true,
      output: {
        locations,
        pageInfo: locationsData.pageInfo,
      },
    }
  },

  outputs: {
    locations: {
      type: 'array',
      description: 'List of locations with their IDs, names, and addresses',
      items: {
        type: 'object',
        properties: LOCATION_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
