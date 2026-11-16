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

describe('Shopify tool calls (operation only in context)', () => {
  it.each([
    'shopify_list_products',
    'shopify_list_orders',
    'shopify_list_customers',
    'shopify_list_collections',
    'shopify_list_locations',
  ])('keeps the model query and sortKey for %s', (operation) => {
    const params = mapParams({ query: 'title:Summer', sortKey: 'ID' }, { operation })
    expect(params.query).toBe('title:Summer')
    expect(params.sortKey).toBe('ID')
  })

  it('keeps the model status filter when listing orders', () => {
    const params = mapParams({ status: 'open' }, { operation: 'shopify_list_orders' })
    expect(params.status).toBe('open')
  })

  it('cancels an order with the model reason and notify flag', () => {
    const params = mapParams(
      { orderId: 'gid://shopify/Order/1', reason: 'CUSTOMER', notifyCustomer: true },
      { operation: 'shopify_cancel_order' }
    )
    expect(params.reason).toBe('CUSTOMER')
    expect(params.notifyCustomer).toBe(true)
  })

  it('keeps model note, email, phone and array tags when updating an order', () => {
    const params = mapParams(
      {
        orderId: 'gid://shopify/Order/1',
        note: 'Gift',
        email: 'a@example.com',
        phone: '+15550100',
        tags: ['vip', ' rush '],
      },
      { operation: 'shopify_update_order' }
    )
    expect(params).toMatchObject({
      note: 'Gift',
      email: 'a@example.com',
      phone: '+15550100',
      tags: ['vip', 'rush'],
    })
  })

  it('keeps model email, note and array tags when creating a customer', () => {
    const params = mapParams(
      { email: 'a@example.com', note: 'VIP', tags: ['vip'] },
      { operation: 'shopify_create_customer' }
    )
    expect(params).toMatchObject({ email: 'a@example.com', note: 'VIP', tags: ['vip'] })
  })

  it('accepts model array tags when creating a product', () => {
    const params = mapParams(
      { title: 'Hat', tags: ['summer', 'sale'] },
      { operation: 'shopify_create_product' }
    )
    expect(params.tags).toEqual(['summer', 'sale'])
  })
})
