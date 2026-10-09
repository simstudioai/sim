import type { ShopifyDeleteProductParams, ShopifyDeleteResponse } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyDeleteProductTool: ToolConfig<
  ShopifyDeleteProductParams,
  ShopifyDeleteResponse
> = {
  id: 'shopify_delete_product',
  name: 'Shopify Delete Product',
  description: 'Delete a product from your Shopify store',
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
    productId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Product ID to delete (gid://shopify/Product/123456789)',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.productId?.trim()) {
        throw new Error('Product ID is required to delete a product')
      }

      return {
        query: `
          mutation productDelete($input: ProductDeleteInput!) {
            productDelete(input: $input) {
              deletedProductId
              userErrors {
                field
                message
              }
            }
          }

        `,
        variables: {
          input: {
            id: params.productId.trim(),
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
        error: data.errors?.[0]?.message || 'Failed to delete product',
        output: {},
      }
    }

    const result = data.data?.productDelete
    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    if (!result?.deletedProductId) {
      return {
        success: false,
        error: 'Product deletion was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        deletedId: result.deletedProductId,
      },
    }
  },

  outputs: {
    deletedId: {
      type: 'string',
      description: 'The ID of the deleted product',
    },
  },
}
