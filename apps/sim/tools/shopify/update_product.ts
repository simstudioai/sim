import type { ShopifyProductResponse, ShopifyUpdateProductParams } from '@/tools/shopify/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyUpdateProductTool: ToolConfig<
  ShopifyUpdateProductParams,
  ShopifyProductResponse
> = {
  id: 'shopify_update_product',
  name: 'Shopify Update Product',
  description: 'Update an existing product in your Shopify store',
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
      description: 'Product ID to update (gid://shopify/Product/123456789)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New product title',
    },
    descriptionHtml: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New product description (HTML)',
    },
    vendor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New product vendor/brand',
    },
    productType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New product type/category',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'New product tags',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New product status (ACTIVE, DRAFT, ARCHIVED)',
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
        throw new Error('Product ID is required to update a product')
      }

      const input: Record<string, unknown> = {
        id: params.productId,
      }

      if (params.title !== undefined) {
        input.title = params.title
      }
      if (params.descriptionHtml !== undefined) {
        input.descriptionHtml = params.descriptionHtml
      }
      if (params.vendor !== undefined) {
        input.vendor = params.vendor
      }
      if (params.productType !== undefined) {
        input.productType = params.productType
      }
      if (params.tags !== undefined) {
        input.tags = params.tags
      }
      if (params.status !== undefined) {
        input.status = params.status
      }

      return {
        query: `
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
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
                variants(first: 10) {
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
                images(first: 10) {
                  edges {
                    node {
                      id
                      url
                      altText
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
        error: data.errors[0]?.message || 'Failed to update product',
        output: {},
      }
    }

    const result = data.data?.productUpdate
    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    const product = result?.product
    if (!product) {
      return {
        success: false,
        error: 'Product update was not successful',
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
      description: 'The updated product',
      properties: PRODUCT_OUTPUT_PROPERTIES,
    },
  },
}
