import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { kalshiCancelOrderTool, kalshiCancelOrderV2Tool } from '@/tools/kalshi/cancel_order'

const ORDER_ID = '3b23c1c7-f4ef-4f0d-8b9a-9e53c61f1a0d'

/** Kalshi's CancelOrderV2Response example (docs.kalshi.com openapi.yaml). */
const CANCEL_V2_EXAMPLE = {
  order_id: ORDER_ID,
  client_order_id: '8c35ecb3-328f-4f52-8c7c-0f4b9862f8d1',
  reduced_by: '10.00',
  ts_ms: 1715793660456,
}

function ed25519Key() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey }
}

describe('Kalshi cancel order uses the V2 event-order endpoint', () => {
  it.each([
    ['kalshi_cancel_order', kalshiCancelOrderTool],
    ['kalshi_cancel_order_v2', kalshiCancelOrderV2Tool],
  ] as const)('%s deletes /portfolio/events/orders/{id} and signs that path', (_, tool) => {
    const { pem, publicKey } = ed25519Key()
    const params = { keyId: 'key-id', privateKey: pem, orderId: ORDER_ID }
    const { url, headers, method } = tool.request
    if (typeof url !== 'function' || typeof headers !== 'function') {
      throw new Error('cancel tool has no request builders')
    }

    const requestUrl = new URL(url(params))
    expect(method).toBe('DELETE')
    expect(requestUrl.pathname).toBe(`/trade-api/v2/portfolio/events/orders/${ORDER_ID}`)

    const sent = headers(params)
    const signedText = `${sent['KALSHI-ACCESS-TIMESTAMP']}DELETE${requestUrl.pathname}`
    expect(
      crypto.verify(
        null,
        Buffer.from(signedText),
        publicKey,
        Buffer.from(sent['KALSHI-ACCESS-SIGNATURE'], 'base64')
      )
    ).toBe(true)
  })

  it('maps the V2 cancel response onto the original outputs', async () => {
    const v1 = await kalshiCancelOrderTool.transformResponse?.(Response.json(CANCEL_V2_EXAMPLE))
    expect(v1?.output).toEqual({
      order: { order_id: ORDER_ID, client_order_id: CANCEL_V2_EXAMPLE.client_order_id },
      reducedBy: 10,
    })

    const v2 = await kalshiCancelOrderV2Tool.transformResponse?.(Response.json(CANCEL_V2_EXAMPLE))
    expect(v2?.output.order).toMatchObject({
      order_id: ORDER_ID,
      client_order_id: CANCEL_V2_EXAMPLE.client_order_id,
      status: null,
    })
    expect(v2?.output.reduced_by).toBe(10)
    expect(v2?.output.reduced_by_fp).toBe('10.00')
  })
})
