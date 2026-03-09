import type { ShopifyBaseParams } from '@/tools/shopify/types'
import {
  INVENTORY_ITEM_OUTPUT_PROPERTIES,
  PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/shopify/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface ShopifyListInventoryItemsParams extends ShopifyBaseParams {
  first?: number
  query?: string
}

interface ShopifyInventoryItemsResponse extends ToolResponse {
  output: {
    inventoryItems?: Array<{
      id: string
      sku: string | null
      tracked: boolean
      createdAt: string
      updatedAt: string
      variant?: {
        id: string
        title: string
        product?: {
          id: string
          title: string
        }
      }
      inventoryLevels: Array<{
        id: string
        available: number
        location: {
          id: string
          name: string
        }
      }>
    }>
    pageInfo?: {
      hasNextPage: boolean
      hasPreviousPage: boolean
    }
  }
}

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
          query listInventoryItems($first: Int!, $query: String) {
            inventoryItems(first: $first, query: $query) {
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
        error: data.errors[0]?.message || 'Failed to list inventory items',
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
          variant?: {
            id: string
            title: string
            product?: {
              id: string
              title: string
            }
          }
          inventoryLevels: {
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
        // Transform inventory levels to include available quantity
        const inventoryLevels = node.inventoryLevels.edges.map((levelEdge) => {
          const levelNode = levelEdge.node
          const availableQty =
            levelNode.quantities.find((q) => q.name === 'available')?.quantity ?? 0
          return {
            id: levelNode.id,
            available: availableQty,
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
