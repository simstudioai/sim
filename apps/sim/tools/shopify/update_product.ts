import type { ShopifyProductResponse, ShopifyUpdateProductParams } from '@/tools/shopify/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyUrl,
  parseShopifyArray,
  parseShopifyObject,
} from '@/tools/shopify/utils'
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
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Shopify Admin API token supplied by the connected credential',
    },
    handle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL-friendly product handle',
    },
    seo: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'SEOInput object with title and description',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product taxonomy category GID',
    },
    templateSuffix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Theme template suffix',
    },
    metafields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'MetafieldInput array: namespace, key, type, value, or id',
    },
    collectionsToJoin: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Collection GIDs to add the product to',
    },
    requiresSellingPlan: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether a selling plan is required to purchase the product',
    },
    collectionsToLeave: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Collection GIDs to remove the product from',
    },
    redirectNewHandle: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create a redirect when changing the handle',
    },
    media: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'CreateMediaInput array with originalSource, mediaContentType, and optional alt',
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
      description: 'New product status (ACTIVE, DRAFT, ARCHIVED, UNLISTED)',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.productId?.trim()) {
        throw new Error('Product ID is required to update a product')
      }

      const input: Record<string, unknown> = {
        id: params.productId.trim(),
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

      if (params.handle !== undefined) input.handle = params.handle
      if (params.seo !== undefined) input.seo = parseShopifyObject(params.seo, 'seo')
      if (params.category !== undefined) input.category = params.category
      if (params.templateSuffix !== undefined) input.templateSuffix = params.templateSuffix
      if (params.metafields !== undefined)
        input.metafields = parseShopifyArray(params.metafields, 'metafields')
      if (params.collectionsToJoin !== undefined)
        input.collectionsToJoin = parseShopifyArray(params.collectionsToJoin, 'collectionsToJoin')
      if (params.requiresSellingPlan !== undefined)
        input.requiresSellingPlan = params.requiresSellingPlan
      if (params.collectionsToLeave !== undefined)
        input.collectionsToLeave = parseShopifyArray(
          params.collectionsToLeave,
          'collectionsToLeave'
        )
      if (params.redirectNewHandle !== undefined) input.redirectNewHandle = params.redirectNewHandle

      return {
        query: `
          mutation productUpdate($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
            productUpdate(product: $product, media: $media) {
              product {
                id
                title
                handle
                templateSuffix
                requiresSellingPlan
                category {
                  id
                  fullName
                }
                seo {
                  title
                  description
                }
                onlineStoreUrl
                options {
                  id
                  name
                  position
                  values
                }
                descriptionHtml
                vendor
                productType
                tags
                status
                createdAt
                updatedAt
                variants(first: 10) {
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                  }
                  edges {
                    node {
                      id
                      title
                      price
                      compareAtPrice
                      sku
                      barcode
                      taxable
                      inventoryPolicy
                      inventoryItem {
                        id
                        sku
                        tracked
                      }
                      selectedOptions {
                        name
                        value
                      }
                      inventoryQuantity
                    }
                  }
                }
                images(first: 10) {
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                  }
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
          product: input,
          media: parseShopifyArray(params.media, 'media'),
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to update product',
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
