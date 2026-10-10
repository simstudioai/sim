import type { ShopifyCreateProductParams, ShopifyProductResponse } from '@/tools/shopify/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import {
  getShopifyHeaders,
  getShopifyUrl,
  parseShopifyArray,
  parseShopifyObject,
} from '@/tools/shopify/utils'
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
    productOptions: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'OptionCreateInput array with name and values: [{name: "Size", values: [{name: "Small"}]}]',
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
      description: 'Product status (ACTIVE, DRAFT, ARCHIVED, UNLISTED)',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
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
      if (params.productOptions !== undefined)
        input.productOptions = parseShopifyArray(params.productOptions, 'productOptions')

      return {
        query: `
          mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
            productCreate(product: $product, media: $media) {
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
        error: data.errors?.[0]?.message || 'Failed to create product',
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
          templateSuffix: product.templateSuffix ?? null,
          requiresSellingPlan: product.requiresSellingPlan,
          category: product.category ?? null,
          seo: product.seo,
          onlineStoreUrl: product.onlineStoreUrl ?? null,
          options: product.options ?? [],
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
