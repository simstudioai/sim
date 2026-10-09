import type {
  ShopifyFulfillmentOrder,
  ShopifyFulfillmentOrdersResponse,
  ShopifyListFulfillmentOrdersParams,
  ShopifyPageInfo,
} from '@/tools/shopify/types'
import {
  FULFILLMENT_ORDER_OUTPUT_PROPERTIES,
  PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyPageSize,
  getShopifyUrl,
  readShopifyResult,
} from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyListFulfillmentOrdersTool: ToolConfig<
  ShopifyListFulfillmentOrdersParams,
  ShopifyFulfillmentOrdersResponse
> = {
  id: 'shopify_list_fulfillment_orders',
  name: 'Shopify List Fulfillment Orders',
  description:
    'Find fulfillment order IDs and remaining items for an order at merchant-managed locations',
  version: '1.0.0',
  oauth: { required: true, provider: 'shopify', authoritativeParams: ['domain', 'idToken'] },
  params: {
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
      description: 'Shop domain supplied by the connected credential (store.myshopify.com)',
    },
    orderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Order GID to retrieve fulfillment orders for',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (default 20, max 20)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from pageInfo.endCursor to continue',
    },
  },
  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.orderId?.trim()) throw new Error('Order ID is required')
      return {
        query: `
          query listFulfillmentOrders($id: ID!, $first: Int!, $after: String) {
            order(id: $id) {
              fulfillmentOrders(first: $first, after: $after) {
                edges {
                  node {
                    id
                    orderId
                    status
                    requestStatus
                    createdAt
                    updatedAt
                    fulfillAt
                    fulfillBy
                    assignedLocation {
                      name
                      location {
                        id
                        name
                      }
                    }
                    supportedActions {
                      action
                      externalUrl
                    }
                    lineItems(first: 10) {
                      edges {
                        node {
                          id
                          totalQuantity
                          remainingQuantity
                          inventoryItemId
                          productTitle
                          variantTitle
                          sku
                          lineItem {
                            id
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
                }
                pageInfo {
                  hasNextPage
                  hasPreviousPage
                  startCursor
                  endCursor
                }
              }
            }
          }

        `,
        variables: {
          id: params.orderId.trim(),
          first: getShopifyPageSize(params.first ?? 20, 20),
          after: params.after?.trim() || null,
        },
      }
    },
  },
  transformResponse: async (response) => {
    const order = await readShopifyResult<{
      fulfillmentOrders: {
        edges: Array<{ node: ShopifyFulfillmentOrder }>
        pageInfo: ShopifyPageInfo
      }
    }>(response, 'order')
    return {
      success: true,
      output: {
        fulfillmentOrders: order.fulfillmentOrders.edges.map((edge) => edge.node),
        pageInfo: order.fulfillmentOrders.pageInfo,
      },
    }
  },
  outputs: {
    fulfillmentOrders: {
      type: 'array',
      description: 'Fulfillment orders visible to the connected app',
      items: { type: 'object', properties: FULFILLMENT_ORDER_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'object',
      description: 'Fulfillment order pagination',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
