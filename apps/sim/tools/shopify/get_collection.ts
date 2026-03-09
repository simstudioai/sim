import type { ShopifyBaseParams } from '@/tools/shopify/types'
import { COLLECTION_WITH_PRODUCTS_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface ShopifyGetCollectionParams extends ShopifyBaseParams {
  collectionId: string
  productsFirst?: number
}

interface ShopifyGetCollectionResponse extends ToolResponse {
  output: {
    collection?: {
      id: string
      title: string
      handle: string
      description: string | null
      descriptionHtml: string | null
      productsCount: number
      sortOrder: string
      updatedAt: string
      image: {
        url: string
        altText: string | null
      } | null
      products: Array<{
        id: string
        title: string
        handle: string
        status: string
        vendor: string
        productType: string
        totalInventory: number
        featuredImage: {
          url: string
          altText: string | null
        } | null
      }>
    }
  }
}

export const shopifyGetCollectionTool: ToolConfig<
  ShopifyGetCollectionParams,
  ShopifyGetCollectionResponse
> = {
  id: 'shopify_get_collection',
  name: 'Shopify Get Collection',
  description:
    'Get a specific collection by ID, including its products. Use this to retrieve products within a collection.',
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
      const productsFirst = Math.min(params.productsFirst || 50, 250)

      return {
        query: `
          query getCollection($id: ID!, $productsFirst: Int!) {
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
                url
                altText
              }
              products(first: $productsFirst) {
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
          id: params.collectionId,
          productsFirst,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to get collection',
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

    // Transform products from edges format and map featuredMedia to featuredImage
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
