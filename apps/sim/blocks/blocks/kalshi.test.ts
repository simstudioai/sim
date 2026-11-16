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
    const args = { keyId: 'key', privateKey: 'pem', orderIdParam: 'ord-1' }

    expect({ ...args, ...buildParams(args, { operation: 'cancel_order' }) }.orderId).toBe('ord-1')
  })
})
