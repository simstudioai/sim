import type { ShopifyCustomersResponse, ShopifyListCustomersParams } from '@/tools/shopify/types'
import { CUSTOMER_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
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
          query listCustomers($first: Int!, $query: String) {
            customers(first: $first, query: $query) {
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
                  amountSpent {
                    amount
                    currencyCode
                  }
                  defaultAddress {
                    address1
                    city
                    province
                    country
                    zip
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
          query: params.query || null,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list customers',
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
        properties: CUSTOMER_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
