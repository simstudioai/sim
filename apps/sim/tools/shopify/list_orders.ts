import type { ShopifyListOrdersParams, ShopifyOrdersResponse } from '@/tools/shopify/types'
import { ORDER_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyListOrdersTool: ToolConfig<ShopifyListOrdersParams, ShopifyOrdersResponse> = {
  id: 'shopify_list_orders',
  name: 'Shopify List Orders',
  description: 'List orders from your Shopify store with optional filtering',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'shopify',
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
    includeDetails: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include expanded nested details; uses a smaller page limit to stay within Shopify query costs',
    },
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
        'Sort results by CREATED_AT, CURRENT_TOTAL_PRICE, CUSTOMER_NAME, DESTINATION, FINANCIAL_STATUS, FULFILLMENT_STATUS, ID, ORDER_NUMBER, PO_NUMBER, PROCESSED_AT, RELEVANCE, TOTAL_ITEMS_QUANTITY, TOTAL_PRICE, UPDATED_AT (default Shopify ordering)',
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
      description:
        'Number of orders to return (default: 50, max: 250; with includeDetails: default/max 10)',
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
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      const first = getShopifyPageSize(
        params.first ?? (params.includeDetails ? 10 : 50),
        params.includeDetails ? 10 : 250
      )

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
          query listOrders($first: Int!, $includeDetails: Boolean!, $after: String, $query: String, $reverse: Boolean, $sortKey: OrderSortKeys) {
            orders(
              first: $first
              after: $after
              query: $query
              reverse: $reverse
              sortKey: $sortKey
            ) {
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
                  poNumber @include(if: $includeDetails)
                  customAttributes @include(if: $includeDetails) {
                    key
                    value
                  }
                  totalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                    presentmentMoney @include(if: $includeDetails) {
                      amount
                      currencyCode
                    }
                  }
                  subtotalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                    presentmentMoney @include(if: $includeDetails) {
                      amount
                      currencyCode
                    }
                  }
                  totalTaxSet @include(if: $includeDetails) {
                    shopMoney {
                      amount
                      currencyCode
                    }
                    presentmentMoney @include(if: $includeDetails) {
                      amount
                      currencyCode
                    }
                  }
                  totalShippingPriceSet @include(if: $includeDetails) {
                    shopMoney {
                      amount
                      currencyCode
                    }
                    presentmentMoney @include(if: $includeDetails) {
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
                    phone @include(if: $includeDetails)
                  }
                  lineItems(first: 10) {
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
                          compareAtPrice @include(if: $includeDetails)
                          inventoryQuantity @include(if: $includeDetails)
                          sku
                          barcode @include(if: $includeDetails)
                          taxable @include(if: $includeDetails)
                          inventoryPolicy @include(if: $includeDetails)
                          inventoryItem @include(if: $includeDetails) {
                            id
                            sku
                            tracked
                          }
                          selectedOptions @include(if: $includeDetails) {
                            name
                            value
                          }
                        }
                        originalTotalSet @include(if: $includeDetails) {
                          shopMoney {
                            amount
                            currencyCode
                          }
                          presentmentMoney @include(if: $includeDetails) {
                            amount
                            currencyCode
                          }
                        }
                        discountedTotalSet @include(if: $includeDetails) {
                          shopMoney {
                            amount
                            currencyCode
                          }
                          presentmentMoney @include(if: $includeDetails) {
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
                    address1 @include(if: $includeDetails)
                    address2 @include(if: $includeDetails)
                    city
                    province
                    provinceCode @include(if: $includeDetails)
                    country
                    countryCode @include(if: $includeDetails)
                    zip
                    phone @include(if: $includeDetails)
                  }
                  billingAddress @include(if: $includeDetails) {
                    firstName
                    lastName
                    address1 @include(if: $includeDetails)
                    address2 @include(if: $includeDetails)
                    city
                    province
                    provinceCode @include(if: $includeDetails)
                    country
                    countryCode @include(if: $includeDetails)
                    zip
                    phone @include(if: $includeDetails)
                  }
                  fulfillments(first: 50) @include(if: $includeDetails) {
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
          includeDetails: params.includeDetails ?? false,
          reverse: params.reverse ?? false,
          sortKey: params.sortKey || undefined,

          first,
          after: params.after?.trim() || null,
          query: queryString,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to list orders',
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
