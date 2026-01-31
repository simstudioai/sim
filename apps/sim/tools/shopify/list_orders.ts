import type { ShopifyListOrdersParams, ShopifyOrdersResponse } from '@/tools/shopify/types'
import { ORDER_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyListOrdersTool: ToolConfig<ShopifyListOrdersParams, ShopifyOrdersResponse> = {
  id: 'shopify_list_orders',
  name: 'Shopify List Orders',
  description: 'List orders from your Shopify store with optional filtering',
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
      description: 'Number of orders to return (default: 50, max: 250)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by order status (open, closed, cancelled, any)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query to filter orders (e.g., "financial_status:paid" or "fulfillment_status:unfulfilled" or "email:customer@example.com")',
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

      // Build query string with status filter if provided
      const queryParts: string[] = []
      if (params.status && params.status !== 'any') {
        queryParts.push(`status:${params.status}`)
      }
      if (params.query) {
        queryParts.push(params.query)
      }
      const queryString = queryParts.length > 0 ? queryParts.join(' ') : null

      return {
        query: `
          query listOrders($first: Int!, $query: String) {
            orders(first: $first, query: $query) {
              edges {
                node {
                  id
                  name
                  email
                  phone
                  createdAt
                  updatedAt
                  cancelledAt
                  closedAt
                  displayFinancialStatus
                  displayFulfillmentStatus
                  totalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  subtotalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  note
                  tags
                  customer {
                    id
                    email
                    firstName
                    lastName
                  }
                  lineItems(first: 10) {
                    edges {
                      node {
                        id
                        title
                        quantity
                        variant {
                          id
                          title
                          price
                          sku
                        }
                      }
                    }
                  }
                  shippingAddress {
                    firstName
                    lastName
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
          query: queryString,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list orders',
        output: {},
      }
    }

    const ordersData = data.data?.orders
    if (!ordersData) {
      return {
        success: false,
        error: 'Failed to retrieve orders',
        output: {},
      }
    }

    const orders = ordersData.edges.map((edge: { node: unknown }) => edge.node)

    return {
      success: true,
      output: {
        orders,
        pageInfo: ordersData.pageInfo,
      },
    }
  },

  outputs: {
    orders: {
      type: 'array',
      description: 'List of orders',
      items: {
        type: 'object',
        properties: ORDER_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
