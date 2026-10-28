import type { ShopifyGetProductParams, ShopifyProductResponse } from '@/tools/shopify/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyGetProductTool: ToolConfig<ShopifyGetProductParams, ShopifyProductResponse> = {
  id: 'shopify_get_product',
  name: 'Shopify Get Product',
  description: 'Get a single product by ID from your Shopify store',
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
    variantsFirst: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum variants in this page (default 50, max 100)',
    },
    variantsAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from variants.pageInfo.endCursor for the next page',
    },
    imagesFirst: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum images in this page (default 20, max 100)',
    },
    imagesAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from images.pageInfo.endCursor for the next page',
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
      description: 'Product ID (gid://shopify/Product/123456789)',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.productId?.trim()) {
        throw new Error('Product ID is required')
      }

      return {
        query: `
          query getProduct($id: ID!, $imagesFirst: Int!, $imagesAfter: String, $variantsFirst: Int!, $variantsAfter: String) {
            product(id: $id) {
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
              variants(first: $variantsFirst, after: $variantsAfter) {
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
              images(first: $imagesFirst, after: $imagesAfter) {
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
          }

        `,
        variables: {
          imagesFirst: getShopifyPageSize(params.imagesFirst ?? 20, 100),
          imagesAfter: params.imagesAfter?.trim() || null,
          variantsFirst: getShopifyPageSize(params.variantsFirst ?? 50, 100),
          variantsAfter: params.variantsAfter?.trim() || null,
          id: params.productId.trim(),
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to get product',
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
