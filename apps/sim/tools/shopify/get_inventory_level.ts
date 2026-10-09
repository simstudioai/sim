import type {
  ShopifyGetInventoryLevelParams,
  ShopifyInventoryResponse,
} from '@/tools/shopify/types'
import { INVENTORY_LEVEL_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyPageSize, getShopifyUrl } from '@/tools/shopify/utils'
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
    authoritativeParams: ['domain', 'idToken'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Shopify Admin API token supplied by the connected credential',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Locations per page when locationId is omitted (default 50, max 250)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from inventoryLevel.pageInfo.endCursor',
    },
    shopDomain: {
      type: 'string',
      required: false,
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
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
    body: (params) => {
      if (!params.inventoryItemId) {
        throw new Error('Inventory item ID is required')
      }

      const locationId = params.locationId?.trim()
      const levelFields = `id
        quantities(names: ["available", "on_hand", "committed", "incoming", "reserved"]) { name quantity }
        location { id name }`
      return {
        query: locationId
          ? `query getInventoryAtLocation($id: ID!, $locationId: ID!) {
              inventoryItem(id: $id) { id sku tracked inventoryLevel(locationId: $locationId) { ${levelFields} } }
            }`
          : `query getInventoryLevels($id: ID!, $first: Int!, $after: String) {
              inventoryItem(id: $id) { id sku tracked
                inventoryLevels(first: $first, after: $after) {
                  edges { node { ${levelFields} } }
                  pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
                }
              }
            }`,
        variables: locationId
          ? { id: params.inventoryItemId.trim(), locationId }
          : {
              id: params.inventoryItemId.trim(),
              first: getShopifyPageSize(params.first),
              after: params.after?.trim() || null,
            },
      }
    },
  },

  transformResponse: async (response, params) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to get inventory level',
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

    const requestedLocationId = params?.locationId?.trim()
    const edges = requestedLocationId
      ? inventoryItem.inventoryLevel
        ? [{ node: inventoryItem.inventoryLevel }]
        : []
      : inventoryItem.inventoryLevels.edges
    const inventoryLevels = edges
      .map(
        (edge: {
          node: {
            id: string
            quantities: Array<{ name: string; quantity: number }>
            location: { id: string; name: string }
          }
        }) => {
          const node = edge.node

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
      .filter(
        (level: { location: { id: string } }) =>
          !requestedLocationId || level.location.id === requestedLocationId
      )

    if (requestedLocationId && inventoryLevels.length === 0) {
      return {
        success: false,
        error: 'No inventory level found for the provided location',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        inventoryLevel: {
          id: inventoryItem.id,
          sku: inventoryItem.sku,
          tracked: inventoryItem.tracked,
          levels: inventoryLevels,
          pageInfo: inventoryItem.inventoryLevels?.pageInfo ?? null,
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
