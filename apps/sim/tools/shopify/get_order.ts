import type { ShopifyGetOrderParams, ShopifyOrderResponse } from '@/tools/shopify/types'
import { ORDER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyGetOrderTool: ToolConfig<ShopifyGetOrderParams, ShopifyOrderResponse> = {
  id: 'shopify_get_order',
  name: 'Shopify Get Order',
  description: 'Get a single order by ID from your Shopify store',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'shopify',
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Shopify Admin API token supplied by the connected credential',
    },
    lineItemsFirst: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum lineItems in this page (default 50, max 50)',
    },
    lineItemsAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from lineItems.pageInfo.endCursor for the next page',
    },

    shopDomain: {
      type: 'string',
      required: false,
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
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.orderId?.trim()) {
        throw new Error('Order ID is required')
      }

      return {
        query: `
          query getOrder($id: ID!, $lineItemsFirst: Int!, $lineItemsAfter: String) {
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
              poNumber
              customAttributes {
                key
                value
              }
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
                presentmentMoney {
                  amount
                  currencyCode
                }
              }
              subtotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
                presentmentMoney {
                  amount
                  currencyCode
                }
              }
              totalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
                presentmentMoney {
                  amount
                  currencyCode
                }
              }
              totalShippingPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
                presentmentMoney {
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
              lineItems(first: $lineItemsFirst, after: $lineItemsAfter) {
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                  endCursor
                }
                edges {
                  node {
                    id
                    title
                    quantity
                    variant {
                      id
                      title
                      price
                      compareAtPrice
                      inventoryQuantity
                      sku
                      barcode
                      taxable
                      inventoryPolicy
                      inventoryItem {
                        id
                        sku
                        tracked
                      }
                      selectedOptions {
                        name
                        value
                      }
                    }
                    originalTotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                      presentmentMoney {
                        amount
                        currencyCode
                      }
                    }
                    discountedTotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                      presentmentMoney {
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
          lineItemsFirst: getShopifyPageSize(params.lineItemsFirst ?? 50, 50),
          lineItemsAfter: params.lineItemsAfter?.trim() || null,
          id: params.orderId.trim(),
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to get order',
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
