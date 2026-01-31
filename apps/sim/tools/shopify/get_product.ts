import type { ShopifyGetProductParams, ShopifyProductResponse } from '@/tools/shopify/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyGetProductTool: ToolConfig<ShopifyGetProductParams, ShopifyProductResponse> = {
  id: 'shopify_get_product',
  name: 'Shopify Get Product',
  description: 'Get a single product by ID from your Shopify store',
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
    productId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Product ID (gid://shopify/Product/123456789)',
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
      if (!params.productId) {
        throw new Error('Product ID is required')
      }

      return {
        query: `
          query getProduct($id: ID!) {
            product(id: $id) {
              id
              title
              handle
              descriptionHtml
              vendor
              productType
              tags
              status
              createdAt
              updatedAt
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    sku
                    inventoryQuantity
                  }
                }
              }
              images(first: 20) {
                edges {
                  node {
                    id
                    url
                    altText
                  }
                }
              }
            }
          }
        `,
        variables: {
          id: params.productId,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to get product',
        output: {},
      }
    }

    const product = data.data?.product
    if (!product) {
      return {
        success: false,
        error: 'Product not found',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        product,
      },
    }
  },

  outputs: {
    product: {
      type: 'object',
      description: 'The product details',
      properties: PRODUCT_OUTPUT_PROPERTIES,
    },
  },
}
