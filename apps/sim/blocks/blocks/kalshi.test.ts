import { describe, expect, it } from 'vitest'
import { KalshiBlock } from '@/blocks/blocks/kalshi'

const buildParams = KalshiBlock.tools.config?.params
if (!buildParams) throw new Error('KalshiBlock has no params mapper')

describe('KalshiBlock', () => {
  /**
   * An agent tool call passes the operation only in `context`; the order ID filled
   * on the tool row must still reach the tool's `orderId` param.
   */
  it('maps the order ID field on an agent tool call', () => {
    const args: Record<string, unknown> = { keyId: 'key', privateKey: 'pem', orderIdParam: 'ord-1' }

    expect({ ...args, ...buildParams(args, { operation: 'cancel_order' }) }.orderId).toBe('ord-1')
  })

  it.each([
    { operation: 'cancel_order', stale: { orderId: 'O-STALE' }, field: { orderIdParam: 'O-NEW' } },
    { operation: 'get_order', stale: { orderId: 'O-STALE' }, field: { orderIdParam: 'O-NEW' } },
    {
      operation: 'amend_order',
      stale: { clientOrderId: 'C-STALE' },
      field: { clientOrderIdAmend: 'C-NEW' },
    },
    { operation: 'get_orders', stale: { status: 'open' }, field: { orderStatus: 'resting' } },
  ])(
    'sends the $operation field over a stale canvas value under the tool param name',
    ({ operation, stale, field }) => {
      const canvas: Record<string, unknown> = {
        operation,
        keyId: 'key',
        privateKey: 'pem',
        ...stale,
        ...field,
      }
      const sent: Record<string, unknown> = { ...canvas, ...buildParams(canvas) }
      expect(sent[Object.keys(stale)[0]]).toBe(Object.values(field)[0])
    }
  )

  it('drops a stale canvas order ID when the operation field is empty', () => {
    const canvas = { operation: 'get_order', orderId: 'O-STALE', orderIdParam: '' }
    expect({ ...canvas, ...buildParams(canvas) }.orderId).toBeUndefined()
  })

  it.each([
    { operation: 'cancel_order', param: 'orderId', field: 'orderIdParam' },
    { operation: 'get_orders', param: 'status', field: 'orderStatus' },
    { operation: 'create_order', param: 'type', field: 'orderType' },
    { operation: 'create_order', param: 'ticker', field: 'tickerOrder' },
  ])(
    'keeps the row-pinned $field over the model $param on a $operation tool call',
    ({ operation, param, field }) => {
      const args = { [field]: 'pinned', [param]: 'model' }
      expect({ ...args, ...buildParams(args, { operation }) }[param]).toBe('pinned')
    }
  )

  it('keeps the model order ID on a tool call when the row leaves the field empty', () => {
    const args = { orderId: 'model' }
    expect({ ...args, ...buildParams(args, { operation: 'cancel_order' }) }.orderId).toBe('model')
  })
})
