import type { ShopifyCancelOrderParams, ShopifyCancelOrderResponse } from '@/tools/shopify/types'
import {
  CANCEL_ORDER_OUTPUT_PROPERTIES,
  CANCELLATION_RESULT_OUTPUT_PROPERTIES,
} from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyUrl, parseShopifyObject } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyCancelOrderTool: ToolConfig<
  ShopifyCancelOrderParams,
  ShopifyCancelOrderResponse
> = {
  id: 'shopify_cancel_order',
  name: 'Shopify Cancel Order',
  description: 'Cancel an order in your Shopify store',
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
    restock: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to restock the inventory committed to the order',
    },
    refundMethod: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional refund method object, for example {"originalPaymentMethodsRefund": true}',
    },
    staffNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A note about the cancellation for staff reference',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.orderId?.trim()) {
        throw new Error('Order ID is required to cancel an order')
      }
      if (!params.reason) {
        throw new Error('Cancellation reason is required')
      }
      if (typeof params.restock !== 'boolean') {
        throw new Error('Restock is required')
      }

      return {
        query: `
          mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $notifyCustomer: Boolean, $refundMethod: OrderCancelRefundMethodInput, $restock: Boolean!, $staffNote: String) {
            orderCancel(
              orderId: $orderId
              reason: $reason
              notifyCustomer: $notifyCustomer
              refundMethod: $refundMethod
              restock: $restock
              staffNote: $staffNote
            ) {
              job {
                id
                done
              }
              jobResult {
                id
                done
                status
                errors {
                  field
                  message
                  code
                }
                order {
                  id
                  cancelledAt
                }
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
          orderId: params.orderId.trim(),
          reason: params.reason,
          notifyCustomer: params.notifyCustomer ?? false,
          refundMethod: parseShopifyObject(params.refundMethod, 'refundMethod') ?? null,
          restock: params.restock,
          staffNote: params.staffNote?.trim() || null,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to cancel order',
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

    if (!result?.job?.id) {
      return { success: false, error: 'Shopify did not return a cancellation job', output: {} }
    }

    return {
      success: true,
      output: {
        job: result.job,
        jobResult: result.jobResult ?? null,
        order: {
          id: result.job.id,
          cancelled: Boolean(result.jobResult?.order?.cancelledAt),
          message: result.jobResult?.order?.cancelledAt
            ? 'Order cancellation completed'
            : 'Order cancellation requested; inspect jobResult status and errors',
        },
      },
    }
  },

  outputs: {
    jobResult: {
      type: 'object',
      optional: true,
      description:
        'Cancellation outcome; pass its ID to Get Job until done, then inspect status and errors',
      properties: CANCELLATION_RESULT_OUTPUT_PROPERTIES,
    },
    job: {
      type: 'object',
      description: 'Legacy job progress; use jobResult to verify cancellation outcome',
      properties: {
        id: { type: 'string', description: 'Job ID' },
        done: {
          type: 'boolean',
          description: 'Whether processing ran; this alone does not prove cancellation succeeded',
        },
      },
    },
    order: {
      type: 'object',
      description: 'The cancellation result',
      properties: CANCEL_ORDER_OUTPUT_PROPERTIES,
    },
  },
}
