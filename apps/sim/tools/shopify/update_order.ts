import type { ShopifyOrderResponse, ShopifyUpdateOrderParams } from '@/tools/shopify/types'
import { ORDER_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyUpdateOrderTool: ToolConfig<ShopifyUpdateOrderParams, ShopifyOrderResponse> = {
  id: 'shopify_update_order',
  name: 'Shopify Update Order',
  description: 'Update an existing order in your Shopify store (note, tags, email)',
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
      description: 'Order ID to update (gid://shopify/Order/123456789)',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New order note',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'New order tags',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New customer email for the order',
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
        throw new Error('Order ID is required to update an order')
      }

      const input: Record<string, unknown> = {
        id: params.orderId,
      }

      if (params.note !== undefined) {
        input.note = params.note
      }
      if (params.tags !== undefined) {
        input.tags = params.tags
      }
      if (params.email !== undefined) {
        input.email = params.email
      }

      return {
        query: `
          mutation orderUpdate($input: OrderInput!) {
            orderUpdate(input: $input) {
              order {
                id
                name
                email
                phone
                createdAt
                updatedAt
                note
                tags
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                customer {
                  id
                  email
                  firstName
                  lastName
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
          input,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to update order',
        output: {},
      }
    }

    const result = data.data?.orderUpdate
    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    const order = result?.order
    if (!order) {
      return {
        success: false,
        error: 'Order update was not successful',
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
      description: 'The updated order',
      properties: ORDER_OUTPUT_PROPERTIES,
    },
  },
}
