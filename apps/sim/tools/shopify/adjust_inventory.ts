import type { ShopifyAdjustInventoryParams, ShopifyInventoryResponse } from '@/tools/shopify/types'
import { INVENTORY_ADJUSTMENT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import type { ToolConfig } from '@/tools/types'

export const shopifyAdjustInventoryTool: ToolConfig<
  ShopifyAdjustInventoryParams,
  ShopifyInventoryResponse
> = {
  id: 'shopify_adjust_inventory',
  name: 'Shopify Adjust Inventory',
  description: 'Adjust inventory quantity for a product variant at a specific location',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Location ID (gid://shopify/Location/123456789)',
    },
    delta: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount to adjust (positive to increase, negative to decrease)',
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
      if (!params.locationId) {
        throw new Error('Location ID is required')
      }
      if (params.delta === undefined || params.delta === null) {
        throw new Error('Delta is required')
      }

      return {
        query: `
          mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) {
              inventoryAdjustmentGroup {
                createdAt
                reason
                changes {
                  name
                  delta
                  quantityAfterChange
                  item {
                    id
                    sku
                  }
                  location {
                    id
                    name
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          input: {
            reason: 'correction',
            name: 'available',
            changes: [
              {
                inventoryItemId: params.inventoryItemId,
                locationId: params.locationId,
                delta: params.delta,
              },
            ],
          },
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to adjust inventory',
        output: {},
      }
    }

    const result = data.data?.inventoryAdjustQuantities
    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.userErrors.map((e: { message: string }) => e.message).join(', '),
        output: {},
      }
    }

    const adjustmentGroup = result?.inventoryAdjustmentGroup
    if (!adjustmentGroup) {
      return {
        success: false,
        error: 'Inventory adjustment was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        inventoryLevel: {
          adjustmentGroup,
          changes: adjustmentGroup.changes,
        },
      },
    }
  },

  outputs: {
    inventoryLevel: {
      type: 'object',
      description: 'The inventory adjustment result',
      properties: INVENTORY_ADJUSTMENT_OUTPUT_PROPERTIES,
    },
  },
}
