import type { ShopifyBaseParams } from '@/tools/shopify/types'
import { COLLECTION_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface ShopifyListCollectionsParams extends ShopifyBaseParams {
  first?: number
  query?: string
}

interface ShopifyCollectionsResponse extends ToolResponse {
  output: {
    collections?: Array<{
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
    }>
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
    }
  }
}

export const shopifyListCollectionsTool: ToolConfig<
  ShopifyListCollectionsParams,
  ShopifyCollectionsResponse
> = {
  id: 'shopify_list_collections',
  name: 'Shopify List Collections',
  description:
    'List product collections from your Shopify store. Filter by title, type (custom/smart), or handle.',
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
      description: 'Number of collections to return (default: 50, max: 250)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query to filter collections (e.g., "title:Summer" or "collection_type:smart")',
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
          query listCollections($first: Int!, $query: String) {
            collections(first: $first, query: $query) {
              edges {
                node {
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
        error: data.errors[0]?.message || 'Failed to list collections',
        output: {},
      }
    }

    const collectionsData = data.data?.collections
    if (!collectionsData) {
      return {
        success: false,
        error: 'Failed to retrieve collections',
        output: {},
      }
    }

    const collections = collectionsData.edges.map(
      (edge: {
        node: {
          id: string
          title: string
          handle: string
          description: string | null
          descriptionHtml: string | null
          productsCount: { count: number }
          sortOrder: string
          updatedAt: string
          image: { url: string; altText: string | null } | null
        }
      }) => ({
        id: edge.node.id,
        title: edge.node.title,
        handle: edge.node.handle,
        description: edge.node.description,
        descriptionHtml: edge.node.descriptionHtml,
        productsCount: edge.node.productsCount?.count ?? 0,
        sortOrder: edge.node.sortOrder,
        updatedAt: edge.node.updatedAt,
        image: edge.node.image,
      })
    )

    return {
      success: true,
      output: {
        collections,
        pageInfo: collectionsData.pageInfo,
      },
    }
  },

  outputs: {
    collections: {
      type: 'array',
      description: 'List of collections with their IDs, titles, and product counts',
      items: {
        type: 'object',
        properties: COLLECTION_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
