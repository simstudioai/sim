import type {
  ShopifyFulfillmentResponse,
  ShopifyGetFulfillmentParams,
  ShopifyPageInfo,
} from '@/tools/shopify/types'
import { FULFILLMENT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyPageSize,
  getShopifyUrl,
  readShopifyResult,
} from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

/** Reads a fulfillment with cursor pagination for its fulfilled line items. */
export const shopifyGetFulfillmentTool: ToolConfig<
  ShopifyGetFulfillmentParams,
  ShopifyFulfillmentResponse
> = {
  id: 'shopify_get_fulfillment',
  name: 'Shopify Get Fulfillment',
  description: 'Read shipment tracking and one page of fulfilled line items',
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
    fulfillmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fulfillment GID',
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
      if (!params.fulfillmentId?.trim()) throw new Error('Fulfillment ID is required')
      return {
        query: `
          query getFulfillment($id: ID!, $first: Int!, $after: String) {
            fulfillment(id: $id) {
              id
              status
              createdAt
              updatedAt
              trackingInfo {
                company
                number
                url
              }
              fulfillmentLineItems(first: $first, after: $after) {
                edges {
                  node {
                    id
                    quantity
                    lineItem {
                      title
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
          id: params.fulfillmentId.trim(),
          first: getShopifyPageSize(params.first),
          after: params.after?.trim() || null,
        },
      }
    },
  },
  transformResponse: async (response) => {
    const fulfillment = await readShopifyResult<{
      id: string
      status: string
      createdAt: string
      updatedAt: string
      trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>
      fulfillmentLineItems: {
        edges: Array<{ node: { id: string; quantity: number | null; lineItem: { title: string } } }>
        pageInfo: ShopifyPageInfo
      }
    }>(response, 'fulfillment')
    return {
      success: true,
      output: {
        fulfillment: {
          id: fulfillment.id,
          status: fulfillment.status,
          createdAt: fulfillment.createdAt,
          updatedAt: fulfillment.updatedAt,
          trackingInfo: fulfillment.trackingInfo ?? [],
          fulfillmentLineItems: fulfillment.fulfillmentLineItems.edges.map((edge) => edge.node),
          lineItemsPageInfo: fulfillment.fulfillmentLineItems.pageInfo,
        },
      },
    }
  },
  outputs: {
    fulfillment: {
      type: 'object',
      description: 'Shipment tracking and line item page',
      properties: FULFILLMENT_OUTPUT_PROPERTIES,
    },
  },
}
