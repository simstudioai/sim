import type { ShopifyListProductsParams, ShopifyProductsResponse } from '@/tools/shopify/types'
import { PAGE_INFO_OUTPUT_PROPERTIES, PRODUCT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
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
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
    includeDetails: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include expanded nested details; uses a smaller page limit to stay within Shopify query costs',
    },
    reverse: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reverse the result sort order (default false)',
    },
    sortKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort results by CREATED_AT, ID, INVENTORY_TOTAL, PRODUCT_TYPE, PUBLISHED_AT, RELEVANCE, TITLE, UPDATED_AT, VENDOR (default Shopify ordering)',
    },

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
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from pageInfo.endCursor to retrieve the next page',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of products to return (default: 50, max: 250; with includeDetails: default/max 20)',
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
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      const first = getShopifyPageSize(
        params.first ?? (params.includeDetails ? 20 : 50),
        params.includeDetails ? 20 : 250
      )

      return {
        query: `
          query listProducts($first: Int!, $includeDetails: Boolean!, $after: String, $query: String, $reverse: Boolean, $sortKey: ProductSortKeys) {
            products(
              first: $first
              after: $after
              query: $query
              reverse: $reverse
              sortKey: $sortKey
            ) {
              edges {
                node {
                  id
                  title
                  handle
                  templateSuffix @include(if: $includeDetails)
                  requiresSellingPlan @include(if: $includeDetails)
                  category @include(if: $includeDetails) {
                    id
                    fullName
                  }
                  seo @include(if: $includeDetails) {
                    title
                    description
                  }
                  onlineStoreUrl @include(if: $includeDetails)
                  options @include(if: $includeDetails) {
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
                        barcode @include(if: $includeDetails)
                        taxable @include(if: $includeDetails)
                        inventoryPolicy @include(if: $includeDetails)
                        inventoryItem @include(if: $includeDetails) {
                          id
                          sku
                          tracked
                        }
                        selectedOptions @include(if: $includeDetails) {
                          name
                          value
                        }
                        inventoryQuantity
                      }
                    }
                  }
                  images(first: 5) {
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
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
            }
          }

        `,
        variables: {
          includeDetails: params.includeDetails ?? false,
          reverse: params.reverse ?? false,
          sortKey: params.sortKey || undefined,

          first,
          after: params.after?.trim() || null,
          query: params.query || null,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to list products',
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
