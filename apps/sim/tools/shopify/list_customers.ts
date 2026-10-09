import type { ShopifyCustomersResponse, ShopifyListCustomersParams } from '@/tools/shopify/types'
import {
  CUSTOMER_SUMMARY_OUTPUT_PROPERTIES,
  PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyListCustomersTool: ToolConfig<
  ShopifyListCustomersParams,
  ShopifyCustomersResponse
> = {
  id: 'shopify_list_customers',
  name: 'Shopify List Customers',
  description: 'List customers from your Shopify store with optional filtering',
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
      description:
        'Sort results by CREATED_AT, ID, LOCATION, NAME, RELEVANCE, UPDATED_AT (default Shopify ordering)',
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
      description: 'Number of customers to return (default: 50, max: 250)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query to filter customers (e.g., "first_name:John" or "last_name:Smith" or "email:*@gmail.com" or "tag:vip")',
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
          query listCustomers($first: Int!, $after: String, $query: String, $reverse: Boolean, $sortKey: CustomerSortKeys) {
            customers(
              first: $first
              after: $after
              query: $query
              reverse: $reverse
              sortKey: $sortKey
            ) {
              edges {
                node {
                  id
                  email
                  firstName
                  lastName
                  phone
                  createdAt
                  updatedAt
                  note
                  tags
                  numberOfOrders
                  locale
                  taxExempt
                  emailMarketingConsent {
                    marketingState
                    marketingOptInLevel
                    consentUpdatedAt
                  }
                  smsMarketingConsent {
                    marketingState
                    marketingOptInLevel
                    consentUpdatedAt
                  }
                  amountSpent {
                    amount
                    currencyCode
                  }
                  defaultAddress {
                    firstName
                    lastName
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

          first,
          after: params.after?.trim() || null,
          query: params.query || null,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to list customers',
        output: {},
      }
    }

    const customersData = data.data?.customers
    if (!customersData) {
      return {
        success: false,
        error: 'Failed to retrieve customers',
        output: {},
      }
    }

    const customers = customersData.edges.map((edge: { node: unknown }) => edge.node)

    return {
      success: true,
      output: {
        customers,
        pageInfo: customersData.pageInfo,
      },
    }
  },

  outputs: {
    customers: {
      type: 'array',
      description: 'List of customers',
      items: {
        type: 'object',
        properties: CUSTOMER_SUMMARY_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
