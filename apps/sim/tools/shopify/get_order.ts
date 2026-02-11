import type { ShopifyGetOrderParams, ShopifyOrderResponse } from '@/tools/shopify/types'
import { ORDER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyGetOrderTool: ToolConfig<ShopifyGetOrderParams, ShopifyOrderResponse> = {
  id: 'shopify_get_order',
  name: 'Shopify Get Order',
  description: 'Get a single order by ID from your Shopify store',
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
    orderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Order ID (gid://shopify/Order/123456789)',
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
      if (!params.orderId) {
        throw new Error('Order ID is required')
      }

      return {
        query: `
          query getOrder($id: ID!) {
            order(id: $id) {
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
              totalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalShippingPriceSet {
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
                phone
              }
              lineItems(first: 50) {
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
                    originalTotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    discountedTotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
              shippingAddress {
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
              billingAddress {
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
              fulfillments {
                id
                status
                createdAt
                updatedAt
                trackingInfo {
                  company
                  number
                  url
                }
              }
            }
          }
        `,
        variables: {
          id: params.orderId,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to get order',
        output: {},
      }
    }

    const order = data.data?.order
    if (!order) {
      return {
        success: false,
        error: 'Order not found',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        order,
      },
    }
  },

  outputs: {
    order: {
      type: 'object',
      description: 'The order details',
      properties: ORDER_OUTPUT_PROPERTIES,
    },
  },
}
