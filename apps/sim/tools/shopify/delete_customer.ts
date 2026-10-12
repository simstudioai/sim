import type { ShopifyDeleteCustomerParams, ShopifyDeleteResponse } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyUrl } from '@/tools/shopify/utils'
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
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID to delete (gid://shopify/Customer/123456789)',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.customerId?.trim()) {
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
            id: params.customerId.trim(),
          },
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to delete customer',
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
