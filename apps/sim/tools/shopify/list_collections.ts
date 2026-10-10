import type {
  ShopifyCollectionsResponse,
  ShopifyListCollectionsParams,
} from '@/tools/shopify/types'
import { COLLECTION_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

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
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
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
      description: 'Sort results by ID, RELEVANCE, TITLE, UPDATED_AT (default Shopify ordering)',
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
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      const first = getShopifyPageSize(params.first, 250)

      return {
        query: `
          query listCollections($first: Int!, $after: String, $query: String, $reverse: Boolean, $sortKey: CollectionSortKeys) {
            collections(
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
        error: data.errors?.[0]?.message || 'Failed to list collections',
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
          image: { id: string | null; url: string; altText: string | null } | null
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
