import type {
  ShopifyFulfillmentOrder,
  ShopifyFulfillmentOrderResponse,
  ShopifyGetFulfillmentOrderParams,
} from '@/tools/shopify/types'
import { FULFILLMENT_ORDER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyPageSize,
  getShopifyUrl,
  readShopifyResult,
} from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

/** Reads assigned fulfillment work and a page of its remaining line items. */
export const shopifyGetFulfillmentOrderTool: ToolConfig<
  ShopifyGetFulfillmentOrderParams,
  ShopifyFulfillmentOrderResponse
> = {
  id: 'shopify_get_fulfillment_order',
  name: 'Shopify Get Fulfillment Order',
  description: 'Read a fulfillment order and one page of line items for partial fulfillment',
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
    fulfillmentOrderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fulfillment order GID',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (default 50, max 250)',
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
      if (!params.fulfillmentOrderId?.trim()) throw new Error('Fulfillment order ID is required')
      return {
        query: `
          query getFulfillmentOrder($id: ID!, $first: Int!, $after: String) {
            fulfillmentOrder(id: $id) {
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
              lineItems(first: $first, after: $after) {
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

        `,
        variables: {
          id: params.fulfillmentOrderId.trim(),
          first: getShopifyPageSize(params.first),
          after: params.after?.trim() || null,
        },
      }
    },
  },
  transformResponse: async (response) => {
    const fulfillmentOrder = await readShopifyResult<ShopifyFulfillmentOrder>(
      response,
      'fulfillmentOrder'
    )
    return { success: true, output: { fulfillmentOrder } }
  },
  outputs: {
    fulfillmentOrder: {
      type: 'object',
      description: 'Fulfillment order with remaining quantities and item pagination',
      properties: FULFILLMENT_ORDER_OUTPUT_PROPERTIES,
    },
  },
}
