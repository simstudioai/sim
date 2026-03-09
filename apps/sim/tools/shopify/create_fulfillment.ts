import type { ShopifyBaseParams } from '@/tools/shopify/types'
import { FULFILLMENT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface ShopifyCreateFulfillmentParams extends ShopifyBaseParams {
  fulfillmentOrderId: string
  trackingNumber?: string
  trackingCompany?: string
  trackingUrl?: string
  notifyCustomer?: boolean
}

interface ShopifyCreateFulfillmentResponse extends ToolResponse {
  output: {
    fulfillment?: {
      id: string
      status: string
      createdAt: string
      updatedAt: string
      trackingInfo: Array<{
        company: string | null
        number: string | null
        url: string | null
      }>
      fulfillmentLineItems: Array<{
        id: string
        quantity: number
        lineItem: {
          title: string
        }
      }>
    }
  }
}

export const shopifyCreateFulfillmentTool: ToolConfig<
  ShopifyCreateFulfillmentParams,
  ShopifyCreateFulfillmentResponse
> = {
  id: 'shopify_create_fulfillment',
  name: 'Shopify Create Fulfillment',
  description:
    'Create a fulfillment to mark order items as shipped. Requires a fulfillment order ID (get this from the order details).',
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
    fulfillmentOrderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The fulfillment order ID (e.g., gid://shopify/FulfillmentOrder/123456789)',
    },
    trackingNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tracking number for the shipment',
    },
    trackingCompany: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Shipping carrier name (e.g., UPS, FedEx, USPS, DHL)',
    },
    trackingUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to track the shipment',
    },
    notifyCustomer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send a shipping confirmation email to the customer (default: true)',
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
      // Build tracking info if any tracking details provided
      const trackingInfo: {
        number?: string
        company?: string
        url?: string
      } = {}

      if (params.trackingNumber) {
        trackingInfo.number = params.trackingNumber
      }
      if (params.trackingCompany) {
        trackingInfo.company = params.trackingCompany
      }
      if (params.trackingUrl) {
        trackingInfo.url = params.trackingUrl
      }

      const fulfillmentInput: {
        lineItemsByFulfillmentOrder: Array<{ fulfillmentOrderId: string }>
        notifyCustomer?: boolean
        trackingInfo?: typeof trackingInfo
      } = {
        lineItemsByFulfillmentOrder: [
          {
            fulfillmentOrderId: params.fulfillmentOrderId,
          },
        ],
        notifyCustomer: params.notifyCustomer !== false, // Default to true
      }

      // Only include trackingInfo if we have at least one tracking field
      if (Object.keys(trackingInfo).length > 0) {
        fulfillmentInput.trackingInfo = trackingInfo
      }

      return {
        query: `
          mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
            fulfillmentCreateV2(fulfillment: $fulfillment) {
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
          fulfillment: fulfillmentInput,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to create fulfillment',
        output: {},
      }
    }

    const result = data.data?.fulfillmentCreateV2
    if (!result) {
      return {
        success: false,
        error: 'Failed to create fulfillment',
        output: {},
      }
    }

    if (result.userErrors && result.userErrors.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    const fulfillment = result.fulfillment
    if (!fulfillment) {
      return {
        success: false,
        error: 'No fulfillment returned',
        output: {},
      }
    }

    // Transform fulfillment line items from edges format
    const fulfillmentLineItems =
      fulfillment.fulfillmentLineItems?.edges?.map((edge: { node: unknown }) => edge.node) || []

    return {
      success: true,
      output: {
        fulfillment: {
          id: fulfillment.id,
          status: fulfillment.status,
          createdAt: fulfillment.createdAt,
          updatedAt: fulfillment.updatedAt,
          trackingInfo: fulfillment.trackingInfo || [],
          fulfillmentLineItems,
        },
      },
    }
  },

  outputs: {
    fulfillment: {
      type: 'object',
      description: 'The created fulfillment with tracking info and fulfilled items',
      properties: FULFILLMENT_OUTPUT_PROPERTIES,
    },
  },
}
