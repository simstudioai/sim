import type { ShopifyCreateProductParams, ShopifyProductResponse } from '@/tools/shopify/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyCreateProductTool: ToolConfig<
  ShopifyCreateProductParams,
  ShopifyProductResponse
> = {
  id: 'shopify_create_product',
  name: 'Shopify Create Product',
  description: 'Create a new product in your Shopify store',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Product title',
    },
    descriptionHtml: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product description (HTML)',
    },
    vendor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product vendor/brand',
    },
    productType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product type/category',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product tags',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product status (ACTIVE, DRAFT, ARCHIVED)',
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
      if (!params.title || !params.title.trim()) {
        throw new Error('Title is required to create a Shopify product')
      }

      const input: Record<string, unknown> = {
        title: params.title,
      }

      if (params.descriptionHtml) {
        input.descriptionHtml = params.descriptionHtml
      }
      if (params.vendor) {
        input.vendor = params.vendor
      }
      if (params.productType) {
        input.productType = params.productType
      }
      if (params.tags && Array.isArray(params.tags)) {
        input.tags = params.tags
      }
      if (params.status) {
        input.status = params.status
      }

      return {
        query: `
          mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
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
        error: data.errors[0]?.message || 'Failed to create product',
        output: {},
      }
    }

    const result = data.data?.productCreate
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
        error: 'Product creation was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        product: {
          id: product.id,
          title: product.title,
          handle: product.handle,
          descriptionHtml: product.descriptionHtml,
          vendor: product.vendor,
          productType: product.productType,
          tags: product.tags,
          status: product.status,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          variants: product.variants,
          images: product.images,
        },
      },
    }
  },

  outputs: {
    product: {
      type: 'object',
      description: 'The created product',
      properties: PRODUCT_OUTPUT_PROPERTIES,
    },
  },
}
