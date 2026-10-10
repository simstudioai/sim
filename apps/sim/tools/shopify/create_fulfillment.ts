import type {
  ShopifyCreateFulfillmentParams,
  ShopifyFulfillmentResponse,
} from '@/tools/shopify/types'
import { FULFILLMENT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyUrl,
  parseShopifyArray,
  parseShopifyObject,
} from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyCreateFulfillmentTool: ToolConfig<
  ShopifyCreateFulfillmentParams,
  ShopifyFulfillmentResponse
> = {
  id: 'shopify_create_fulfillment',
  name: 'Shopify Create Fulfillment',
  description:
    'Create a fulfillment to mark order items as shipped. Requires a fulfillment order ID (use List Fulfillment Orders to find it).',
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
    fulfillmentOrderLineItems: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Partial fulfillment items as [{id: "gid://shopify/FulfillmentOrderLineItem/123", quantity: 1}]; omit to fulfill all remaining items',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message associated with the fulfillment',
    },
    originAddress: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'FulfillmentOriginAddressInput with address1, address2, city, countryCode, provinceCode, zip',
    },
    trackingNumbers: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple tracking numbers as a JSON string array',
    },
    trackingUrls: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Multiple tracking URLs as a JSON string array',
    },

    shopDomain: {
      type: 'string',
      required: false,
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
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.fulfillmentOrderId?.trim()) throw new Error('Fulfillment order ID is required')

      const trackingInfo: {
        number?: string
        company?: string
        url?: string
        numbers?: string[]
        urls?: string[]
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

      const trackingNumbers = parseShopifyArray<string>(params.trackingNumbers, 'trackingNumbers')
      const trackingUrls = parseShopifyArray<string>(params.trackingUrls, 'trackingUrls')
      if (trackingNumbers !== undefined) trackingInfo.numbers = trackingNumbers
      if (trackingUrls !== undefined) trackingInfo.urls = trackingUrls

      const fulfillmentInput: {
        lineItemsByFulfillmentOrder: Array<{
          fulfillmentOrderId: string
          fulfillmentOrderLineItems?: Array<Record<string, unknown>>
        }>
        originAddress?: Record<string, unknown>
        notifyCustomer?: boolean
        trackingInfo?: typeof trackingInfo
      } = {
        lineItemsByFulfillmentOrder: [
          {
            fulfillmentOrderId: params.fulfillmentOrderId.trim(),
            fulfillmentOrderLineItems: parseShopifyArray(
              params.fulfillmentOrderLineItems,
              'fulfillmentOrderLineItems'
            ),
          },
        ],
        notifyCustomer: params.notifyCustomer ?? true,
        originAddress: parseShopifyObject(params.originAddress, 'originAddress'),
      }

      if (Object.keys(trackingInfo).length > 0) {
        fulfillmentInput.trackingInfo = trackingInfo
      }

      return {
        query: `
          mutation fulfillmentCreate($fulfillment: FulfillmentInput!, $message: String) {
            fulfillmentCreate(fulfillment: $fulfillment, message: $message) {
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
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                  }
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
          message: params.message,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to create fulfillment',
        output: {},
      }
    }

    const result = data.data?.fulfillmentCreate
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
          lineItemsPageInfo: fulfillment.fulfillmentLineItems.pageInfo,
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
