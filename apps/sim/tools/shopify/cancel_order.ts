import type { ShopifyCancelOrderParams, ShopifyOrderResponse } from '@/tools/shopify/types'
import { CANCEL_ORDER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyCancelOrderTool: ToolConfig<ShopifyCancelOrderParams, ShopifyOrderResponse> = {
  id: 'shopify_cancel_order',
  name: 'Shopify Cancel Order',
  description: 'Cancel an order in your Shopify store',
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
      description: 'Order ID to cancel (gid://shopify/Order/123456789)',
    },
    reason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cancellation reason (CUSTOMER, DECLINED, FRAUD, INVENTORY, STAFF, OTHER)',
    },
    notifyCustomer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to notify the customer about the cancellation',
    },
    refund: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to refund the order',
    },
    restock: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to restock the inventory',
    },
    staffNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A note about the cancellation for staff reference',
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
        throw new Error('Order ID is required to cancel an order')
      }
      if (!params.reason) {
        throw new Error('Cancellation reason is required')
      }

      return {
        query: `
          mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $notifyCustomer: Boolean, $refund: Boolean!, $restock: Boolean!, $staffNote: String) {
            orderCancel(orderId: $orderId, reason: $reason, notifyCustomer: $notifyCustomer, refund: $refund, restock: $restock, staffNote: $staffNote) {
              job {
                id
                done
              }
              orderCancelUserErrors {
                field
                message
                code
              }
            }
          }
        `,
        variables: {
          orderId: params.orderId,
          reason: params.reason,
          notifyCustomer: params.notifyCustomer ?? false,
          refund: params.refund ?? false,
          restock: params.restock ?? false,
          staffNote: params.staffNote || null,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to cancel order',
        output: {},
      }
    }

    const result = data.data?.orderCancel
    if (result?.orderCancelUserErrors?.length > 0) {
      return {
        success: false,
        error: result.orderCancelUserErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        order: {
          id: result?.job?.id,
          cancelled: result?.job?.done ?? true,
          message: 'Order cancellation initiated',
        },
      },
    }
  },

  outputs: {
    order: {
      type: 'object',
      description: 'The cancellation result',
      properties: CANCEL_ORDER_OUTPUT_PROPERTIES,
    },
  },
}
