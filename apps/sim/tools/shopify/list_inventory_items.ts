import {
  INVENTORY_ITEM_OUTPUT_PROPERTIES,
  PAGE_INFO_OUTPUT_PROPERTIES,
  type ShopifyInventoryItemsResponse,
  type ShopifyListInventoryItemsParams,
} from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyListInventoryItemsTool: ToolConfig<
  ShopifyListInventoryItemsParams,
  ShopifyInventoryItemsResponse
> = {
  id: 'shopify_list_inventory_items',
  name: 'Shopify List Inventory Items',
  description:
    'List inventory items from your Shopify store. Use this to find inventory item IDs by SKU.',
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
      description: 'Number of inventory items to return (default: 50, max: 250)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter inventory items (e.g., "sku:ABC123")',
    },
  },

  request: {
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      const first = getShopifyPageSize(params.first)

      return {
        query: `
          query listInventoryItems($first: Int!, $after: String, $query: String, $reverse: Boolean) {
            inventoryItems(first: $first, after: $after, query: $query, reverse: $reverse) {
              edges {
                node {
                  id
                  sku
                  tracked
                  createdAt
                  updatedAt
                  variant {
                    id
                    title
                    product {
                      id
                      title
                    }
                  }
                  inventoryLevels(first: 10) {
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                    edges {
                      node {
                        id
                        quantities(names: ["available", "on_hand"]) {
                          name
                          quantity
                        }
                        location {
                          id
                          name
                        }
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
          reverse: params.reverse ?? false,

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
        error: data.errors?.[0]?.message || 'Failed to list inventory items',
        output: {},
      }
    }

    const inventoryItemsData = data.data?.inventoryItems
    if (!inventoryItemsData) {
      return {
        success: false,
        error: 'Failed to retrieve inventory items',
        output: {},
      }
    }

    const inventoryItems = inventoryItemsData.edges.map(
      (edge: {
        node: {
          id: string
          sku: string | null
          tracked: boolean
          createdAt: string
          updatedAt: string
          variant: {
            id: string
            title: string
            product: {
              id: string
              title: string
            }
          }
          inventoryLevels: {
            pageInfo: {
              hasNextPage: boolean
              hasPreviousPage: boolean
              startCursor: string | null
              endCursor: string | null
            }
            edges: Array<{
              node: {
                id: string
                quantities: Array<{ name: string; quantity: number }>
                location: { id: string; name: string }
              }
            }>
          }
        }
      }) => {
        const node = edge.node

        const inventoryLevels = node.inventoryLevels.edges.map((levelEdge) => {
          const levelNode = levelEdge.node
          const availableQty =
            levelNode.quantities.find((q) => q.name === 'available')?.quantity ?? 0
          return {
            id: levelNode.id,
            available: availableQty,
            onHand: levelNode.quantities.find((q) => q.name === 'on_hand')?.quantity ?? 0,
            location: levelNode.location,
          }
        })

        return {
          id: node.id,
          sku: node.sku,
          tracked: node.tracked,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          variant: node.variant,
          inventoryLevels,
          inventoryLevelsPageInfo: node.inventoryLevels.pageInfo,
        }
      }
    )

    return {
      success: true,
      output: {
        inventoryItems,
        pageInfo: inventoryItemsData.pageInfo,
      },
    }
  },

  outputs: {
    inventoryItems: {
      type: 'array',
      description: 'List of inventory items with their IDs, SKUs, and stock levels',
      items: {
        type: 'object',
        properties: INVENTORY_ITEM_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
