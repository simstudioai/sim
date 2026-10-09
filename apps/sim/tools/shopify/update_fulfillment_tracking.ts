import type {
  ShopifyFulfillmentResponse,
  ShopifyPageInfo,
  ShopifyUpdateFulfillmentTrackingParams,
  ShopifyUserError,
} from '@/tools/shopify/types'
import { FULFILLMENT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyUrl,
  parseShopifyObject,
  readShopifyResult,
} from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyUpdateFulfillmentTrackingTool: ToolConfig<
  ShopifyUpdateFulfillmentTrackingParams,
  ShopifyFulfillmentResponse
> = {
  id: 'shopify_update_fulfillment_tracking',
  name: 'Shopify Update Fulfillment Tracking',
  description: 'Update tracking numbers, URLs, or carrier for an existing fulfillment',
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
    trackingInfo: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'FulfillmentTrackingInput object: company, number, url, or numbers and urls arrays',
    },
    notifyCustomer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send the customer an updated shipment notification',
    },
  },
  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.fulfillmentId?.trim()) throw new Error('Fulfillment ID is required')
      const trackingInfoInput = parseShopifyObject(params.trackingInfo, 'trackingInfo')
      if (!trackingInfoInput) throw new Error('Tracking information is required')
      return {
        query: `
          mutation updateTracking($id: ID!, $trackingInfo: FulfillmentTrackingInput!, $notify: Boolean) {
            fulfillmentTrackingInfoUpdate(
              fulfillmentId: $id
              trackingInfoInput: $trackingInfo
              notifyCustomer: $notify
            ) {
              fulfillment {
                id
                status
                createdAt
                updatedAt
                trackingInfo {
                  company
                  number
                  url
                }
                fulfillmentLineItems(first: 50) {
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
              userErrors {
                field
                message
              }
            }
          }

        `,
        variables: {
          id: params.fulfillmentId.trim(),
          trackingInfo: trackingInfoInput,
          notify: params.notifyCustomer ?? false,
        },
      }
    },
  },
  transformResponse: async (response) => {
    const result = await readShopifyResult<{
      fulfillment: {
        id: string
        status: string
        createdAt: string
        updatedAt: string
        trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>
        fulfillmentLineItems: {
          edges: Array<{
            node: { id: string; quantity: number | null; lineItem: { title: string } }
          }>
          pageInfo: ShopifyPageInfo
        }
      } | null
      userErrors: ShopifyUserError[]
    }>(response, 'fulfillmentTrackingInfoUpdate')
    if (result.userErrors.length || !result.fulfillment)
      return {
        success: false,
        error: result.userErrors.map((e) => e.message).join(', ') || 'No fulfillment returned',
        output: {},
      }
    const fulfillment = result.fulfillment
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
      description: 'Updated shipment tracking and line item page',
      properties: FULFILLMENT_OUTPUT_PROPERTIES,
    },
  },
}
