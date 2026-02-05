import type {
  ShopifyGetInventoryLevelParams,
  ShopifyInventoryResponse,
} from '@/tools/shopify/types'
import { INVENTORY_LEVEL_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyGetInventoryLevelTool: ToolConfig<
  ShopifyGetInventoryLevelParams,
  ShopifyInventoryResponse
> = {
  id: 'shopify_get_inventory_level',
  name: 'Shopify Get Inventory Level',
  description: 'Get inventory level for a product variant at a specific location',
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
    inventoryItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Inventory item ID (gid://shopify/InventoryItem/123456789)',
    },
    locationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location ID to filter by (optional)',
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
      if (!params.inventoryItemId) {
        throw new Error('Inventory item ID is required')
      }

      return {
        query: `
          query getInventoryItem($id: ID!) {
            inventoryItem(id: $id) {
              id
              sku
              tracked
              inventoryLevels(first: 50) {
                edges {
                  node {
                    id
                    quantities(names: ["available", "on_hand", "committed", "incoming", "reserved"]) {
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
        `,
        variables: {
          id: params.inventoryItemId,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to get inventory level',
        output: {},
      }
    }

    const inventoryItem = data.data?.inventoryItem
    if (!inventoryItem) {
      return {
        success: false,
        error: 'Inventory item not found',
        output: {},
      }
    }

    const inventoryLevels = inventoryItem.inventoryLevels.edges.map(
      (edge: {
        node: {
          id: string
          quantities: Array<{ name: string; quantity: number }>
          location: { id: string; name: string }
        }
      }) => {
        const node = edge.node
        // Extract quantities into a more usable format
        const quantitiesMap: Record<string, number> = {}
        node.quantities.forEach((q) => {
          quantitiesMap[q.name] = q.quantity
        })
        return {
          id: node.id,
          available: quantitiesMap.available ?? 0,
          onHand: quantitiesMap.on_hand ?? 0,
          committed: quantitiesMap.committed ?? 0,
          incoming: quantitiesMap.incoming ?? 0,
          reserved: quantitiesMap.reserved ?? 0,
          location: node.location,
        }
      }
    )

    return {
      success: true,
      output: {
        inventoryLevel: {
          id: inventoryItem.id,
          sku: inventoryItem.sku,
          tracked: inventoryItem.tracked,
          levels: inventoryLevels,
        },
      },
    }
  },

  outputs: {
    inventoryLevel: {
      type: 'object',
      description: 'The inventory level details',
      properties: INVENTORY_LEVEL_OUTPUT_PROPERTIES,
    },
  },
}
