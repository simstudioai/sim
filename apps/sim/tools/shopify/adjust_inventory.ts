import { generateId } from '@sim/utils/id'
import { deriveDeliveryKey } from '@/lib/core/http/derive-key'
import type {
  ShopifyAdjustInventoryParams,
  ShopifyInventoryAdjustmentResponse,
} from '@/tools/shopify/types'
import { INVENTORY_ADJUSTMENT_OUTPUT_PROPERTIES } from '@/tools/shopify/types'
import { getShopifyHeaders, getShopifyUrl } from '@/tools/shopify/utils'
import type { ToolConfig } from '@/tools/types'

export const shopifyAdjustInventoryTool: ToolConfig<
  ShopifyAdjustInventoryParams & {
    _context?: { executionId?: string; blockId?: string; invocationId?: string }
  },
  ShopifyInventoryAdjustmentResponse
> = {
  id: 'shopify_adjust_inventory',
  name: 'Shopify Adjust Inventory',
  description: 'Adjust inventory quantity for a product variant at a specific location',
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
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unique key for this adjustment; reuse the same key when retrying the same change',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Inventory reason, e.g. correction, received, damaged, or promotion (default correction)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inventory quantity to adjust: available or on_hand (default available)',
    },
    referenceDocumentUri: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URI identifying the source document for this adjustment',
    },
    changeFromQuantity: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expected current quantity; prevents applying an adjustment to stale stock',
    },
    ledgerDocumentUri: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ledger entry URI; required when adjusting on_hand',
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
    url: getShopifyUrl,
    method: 'POST',
    headers: getShopifyHeaders,
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

      if (!Number.isInteger(params.delta)) throw new Error('Delta must be an integer')
      if (params.changeFromQuantity != null && !Number.isInteger(params.changeFromQuantity))
        throw new Error('Expected quantity must be an integer')

      if (params.name && params.name !== 'available' && !params.ledgerDocumentUri?.trim()) {
        throw new Error('A ledger document URI is required for non-available inventory changes')
      }

      const context = params._context
      const idempotencyKey =
        params.idempotencyKey?.trim() ||
        (context?.executionId && context.blockId && context.invocationId
          ? deriveDeliveryKey(
              {
                executionId: context.executionId,
                blockId: context.blockId,
                invocationId: context.invocationId,
                toolId: 'shopify_adjust_inventory',
              },
              'shopify_adjust_inventory'
            )
          : generateId())

      return {
        query: `
          mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
            inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
              inventoryAdjustmentGroup {
                createdAt
                reason
                referenceDocumentUri
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
          idempotencyKey,
          input: {
            referenceDocumentUri: params.referenceDocumentUri,
            reason: params.reason || 'correction',
            name: params.name || 'available',
            changes: [
              {
                inventoryItemId: params.inventoryItemId.trim(),
                locationId: params.locationId.trim(),
                delta: params.delta,
                changeFromQuantity: params.changeFromQuantity ?? null,
                ledgerDocumentUri: params.ledgerDocumentUri,
              },
            ],
          },
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.errors?.length) {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to adjust inventory',
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
