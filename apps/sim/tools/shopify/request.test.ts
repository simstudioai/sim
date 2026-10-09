import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it } from 'vitest'
import { shopifyAdjustInventoryTool } from '@/tools/shopify/adjust_inventory'
import { shopifyCancelOrderTool } from '@/tools/shopify/cancel_order'
import { shopifyCreateFulfillmentTool } from '@/tools/shopify/create_fulfillment'
import { shopifyGetProductTool } from '@/tools/shopify/get_product'
import { shopifyUpdateOrderTool } from '@/tools/shopify/update_order'
import { shopifyUpdateProductVariantsTool } from '@/tools/shopify/update_product_variants'

describe('Shopify credential destination', () => {
  it.each([
    'attacker.example',
    'store.myshopify.com.attacker.example',
    'store.myshopify.com@attacker.example',
    'store.myshopify.com/../../other',
    'store.myshopify.com:8443',
  ])('rejects a non-store destination before attaching credentials: %s', (shopDomain) => {
    const url = shopifyGetProductTool.request.url
    expect(() =>
      typeof url === 'function'
        ? url({ shopDomain, accessToken: 'test-token', productId: 'gid://shopify/Product/1' })
        : url
    ).toThrow(/domain/i)
  })

  it('keeps OAuth requests bound to the connected shop when a manual domain is supplied', () => {
    const url = shopifyGetProductTool.request.url
    const result =
      typeof url === 'function'
        ? url({
            shopDomain: 'another.myshopify.com',
            domain: 'caller.myshopify.com',
            idToken: 'connected.myshopify.com',
            accessToken: 'test-token',
            productId: 'gid://shopify/Product/1',
          })
        : url
    expect(new URL(result).hostname).toBe('connected.myshopify.com')
  })
})

describe('Shopify inventory compatibility', () => {
  const params = {
    accessToken: 'test-token',
    inventoryItemId: 'gid://shopify/InventoryItem/1',
    locationId: 'gid://shopify/Location/1',
    delta: 1,
  }

  it('explicitly opts legacy adjustments out of the new quantity precondition', async () => {
    const body = shopifyAdjustInventoryTool.request.body?.(params)
    const wire = await jsonResponse(body).json()
    expect(wire.variables.input.changes[0].changeFromQuantity).toBeNull()
  })

  it('rejects on-hand adjustments without a ledger document before sending a mutation', () => {
    expect(() => shopifyAdjustInventoryTool.request.body?.({ ...params, name: 'on_hand' })).toThrow(
      /ledger/i
    )
  })
})

describe('Shopify partial variant updates', () => {
  it('keeps committed variants available to downstream steps when partial updates were requested', async () => {
    const result = await shopifyUpdateProductVariantsTool.transformResponse?.(
      jsonResponse({
        data: {
          productVariantsBulkUpdate: {
            productVariants: [{ id: 'gid://shopify/ProductVariant/1', price: '12.00' }],
            userErrors: [{ field: ['variants', '1', 'price'], message: 'Invalid price' }],
          },
        },
      }),
      {
        accessToken: 'test-token',
        productId: 'gid://shopify/Product/1',
        variants: [],
        allowPartialUpdates: true,
      }
    )
    expect(result?.success).toBe(true)
    expect(result?.output.productVariants?.[0].id).toBe('gid://shopify/ProductVariant/1')
    expect(result?.output.userErrors).toHaveLength(1)
  })
})

describe('Shopify fulfillment tracking', () => {
  it('omits tracking input from the wire when no tracking details were supplied', async () => {
    const body = shopifyCreateFulfillmentTool.request.body?.({
      accessToken: 'test-token',
      fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
    })
    const wire = await jsonResponse(body).json()
    expect(wire.variables.fulfillment).not.toHaveProperty('trackingInfo')
  })
})

describe('Shopify order update scope compatibility', () => {
  it.each([undefined, false, true])(
    'requests product, address, and fulfillment details only when explicitly enabled (%s)',
    async (includeDetails) => {
      const body = shopifyUpdateOrderTool.request.body?.({
        accessToken: 'test-token',
        orderId: 'gid://shopify/Order/1',
        note: 'Updated note',
        includeDetails,
      })
      const wire = await jsonResponse(body).json()
      for (const field of ['variant', 'shippingAddress', 'billingAddress', 'fulfillments']) {
        const selection = new RegExp(`\\b${field}\\s*(?:\\([^)]*\\))?\\s*\\{`)
        expect(selection.test(wire.query)).toBe(includeDetails === true)
      }
      expect(wire.variables.input).toEqual({ id: 'gid://shopify/Order/1', note: 'Updated note' })
    }
  )
})

describe('Shopify order cancellation acknowledgement', () => {
  it.each([{}, { data: { orderCancel: { job: null, orderCancelUserErrors: [] } } }])(
    'never reports a missing cancellation job as a completed cancellation',
    async (payload) => {
      const result = await shopifyCancelOrderTool.transformResponse?.(jsonResponse(payload))
      expect(result?.success).toBe(false)
    }
  )
})
