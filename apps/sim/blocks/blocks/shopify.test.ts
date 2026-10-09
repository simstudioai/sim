import { describe, expect, it } from 'vitest'
import { ShopifyBlock } from '@/blocks/blocks/shopify'

const mapParams = ShopifyBlock.tools.config?.params
if (!mapParams) throw new Error('Shopify parameter mapping is required')

describe('Shopify operation changes', () => {
  it.each(['first', 'variantsFirst', 'imagesFirst', 'lineItemsFirst', 'changeFromQuantity'])(
    'ignores a stale hidden %s value when updating an order',
    (field) => {
      const params = mapParams({
        operation: 'shopify_update_order',
        orderId: 'gid://shopify/Order/1',
        orderNote: 'Updated note',
        [field]: 'stale invalid number',
      })
      expect(params.orderId).toBe('gid://shopify/Order/1')
      expect(params.note).toBe('Updated note')
    }
  )

  it.each([
    ['shopify_update_product', 'templateSuffix', 'productId', 'gid://shopify/Product/1'],
    ['shopify_update_order', 'poNumber', 'orderId', 'gid://shopify/Order/1'],
  ])('preserves explicit clears for %s field %s', (operation, field, idField, id) => {
    expect(mapParams({ operation, [idField]: id, [field]: '' })[field]).toBe('')
    expect(mapParams({ operation, [idField]: id })[field]).toBeUndefined()
  })
})
