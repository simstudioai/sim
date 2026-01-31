import type { ShopifyListProductsParams, ShopifyProductsResponse } from '@/tools/shopify/types'
import { PAGE_INFO_OUTPUT_PROPERTIES, PRODUCT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyListProductsTool: ToolConfig<
  ShopifyListProductsParams,
  ShopifyProductsResponse
> = {
  id: 'shopify_list_products',
  name: 'Shopify List Products',
  description: 'List products from your Shopify store with optional filtering',
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
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of products to return (default: 50, max: 250)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query to filter products (e.g., "title:shirt" or "vendor:Nike" or "status:active")',
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
      const first = Math.min(params.first || 50, 250)

      return {
        query: `
          query listProducts($first: Int!, $query: String) {
            products(first: $first, query: $query) {
              edges {
                node {
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
                  images(first: 5) {
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
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        `,
        variables: {
          first,
          query: params.query || null,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list products',
        output: {},
      }
    }

    const productsData = data.data?.products
    if (!productsData) {
      return {
        success: false,
        error: 'Failed to retrieve products',
        output: {},
      }
    }

    const products = productsData.edges.map((edge: { node: unknown }) => edge.node)

    return {
      success: true,
      output: {
        products,
        pageInfo: productsData.pageInfo,
      },
    }
  },

  outputs: {
    products: {
      type: 'array',
      description: 'List of products',
      items: {
        type: 'object',
        properties: PRODUCT_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
