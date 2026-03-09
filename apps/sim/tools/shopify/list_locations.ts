import type { ShopifyBaseParams } from '@/tools/shopify/types'
import { LOCATION_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface ShopifyListLocationsParams extends ShopifyBaseParams {
  first?: number
  includeInactive?: boolean
}

interface ShopifyLocationsResponse extends ToolResponse {
  output: {
    locations?: Array<{
      id: string
      name: string
      isActive: boolean
      fulfillsOnlineOrders: boolean
      address: {
        address1: string | null
        address2: string | null
        city: string | null
        province: string | null
        provinceCode: string | null
        country: string | null
        countryCode: string | null
        zip: string | null
        phone: string | null
      } | null
    }>
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
    }
  }
}

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
  },

  params: {
    shopDomain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Shopify store domain (e.g., mystore.myshopify.com)',
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
    url: (params) =>
      `https://${params.shopDomain || params.idToken}/admin/api/2024-10/graphql.json`,
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Shopify API request')
      }
      return {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': params.accessToken,
      }
    },
    body: (params) => {
      const first = Math.min(params.first || 50, 250)

      return {
        query: `
          query listLocations($first: Int!, $includeInactive: Boolean) {
            locations(first: $first, includeInactive: $includeInactive) {
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
              }
            }
          }
        `,
        variables: {
          first,
          includeInactive: params.includeInactive || false,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list locations',
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
