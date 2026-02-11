import type { ShopifyDeleteCustomerParams, ShopifyDeleteResponse } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyDeleteCustomerTool: ToolConfig<
  ShopifyDeleteCustomerParams,
  ShopifyDeleteResponse
> = {
  id: 'shopify_delete_customer',
  name: 'Shopify Delete Customer',
  description: 'Delete a customer from your Shopify store',
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
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID to delete (gid://shopify/Customer/123456789)',
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
      if (!params.customerId) {
        throw new Error('Customer ID is required to delete a customer')
      }

      return {
        query: `
          mutation customerDelete($input: CustomerDeleteInput!) {
            customerDelete(input: $input) {
              deletedCustomerId
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          input: {
            id: params.customerId,
          },
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete customer',
        output: {},
      }
    }

    const result = data.data?.customerDelete
    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    if (!result?.deletedCustomerId) {
      return {
        success: false,
        error: 'Customer deletion was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        deletedId: result.deletedCustomerId,
      },
    }
  },

  outputs: {
    deletedId: {
      type: 'string',
      description: 'The ID of the deleted customer',
    },
  },
}
