import type { ShopifyCollectionResponse, ShopifyGetCollectionParams } from '@/tools/shopify/types'
import { COLLECTION_WITH_PRODUCTS_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyGetCollectionTool: ToolConfig<
  ShopifyGetCollectionParams,
  ShopifyCollectionResponse
> = {
  id: 'shopify_get_collection',
  name: 'Shopify Get Collection',
  description:
    'Get a specific collection by ID, including its products. Use this to retrieve products within a collection.',
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
    productsAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from products.pageInfo.endCursor for the next page',
    },

    shopDomain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Your Shopify store domain (e.g., mystore.myshopify.com)',
    },
    collectionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The collection ID (e.g., gid://shopify/Collection/123456789)',
    },
    productsFirst: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of products to return from this collection (default: 50, max: 250)',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      const productsFirst = getShopifyPageSize(params.productsFirst)

      return {
        query: `
          query getCollection($id: ID!, $productsFirst: Int!, $productsAfter: String) {
            collection(id: $id) {
              id
              title
              handle
              description
              descriptionHtml
              productsCount {
                count
              }
              sortOrder
              updatedAt
              image {
                id
                url
                altText
              }
              products(first: $productsFirst, after: $productsAfter) {
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
                    handle
                    status
                    vendor
                    productType
                    totalInventory
                    featuredMedia {
                      preview {
                        image {
                          url
                          altText
                        }
                      }
                    }
                  }
                }
              }
            }
          }

        `,
        variables: {
          id: params.collectionId.trim(),
          productsFirst,
          productsAfter: params.productsAfter?.trim() || null,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to get collection',
        output: {},
      }
    }

    const collection = data.data?.collection
    if (!collection) {
      return {
        success: false,
        error: 'Collection not found',
        output: {},
      }
    }

    const products =
      collection.products?.edges?.map(
        (edge: {
          node: {
            id: string
            title: string
            handle: string
            status: string
            vendor: string
            productType: string
            totalInventory: number
            featuredMedia?: {
              preview?: {
                image?: {
                  url: string
                  altText: string | null
                }
              }
            }
          }
        }) => {
          const product = edge.node
          return {
            id: product.id,
            title: product.title,
            handle: product.handle,
            status: product.status,
            vendor: product.vendor,
            productType: product.productType,
            totalInventory: product.totalInventory,
            featuredImage: product.featuredMedia?.preview?.image || null,
          }
        }
      ) || []

    return {
      success: true,
      output: {
        collection: {
          id: collection.id,
          title: collection.title,
          handle: collection.handle,
          description: collection.description,
          descriptionHtml: collection.descriptionHtml,
          productsCount: collection.productsCount?.count ?? 0,
          sortOrder: collection.sortOrder,
          updatedAt: collection.updatedAt,
          image: collection.image,
          products,
          productsPageInfo: collection.products.pageInfo,
        },
      },
    }
  },

  outputs: {
    collection: {
      type: 'object',
      description: 'The collection details including its products',
      properties: COLLECTION_WITH_PRODUCTS_OUTPUT_PROPERTIES,
    },
  },
}
