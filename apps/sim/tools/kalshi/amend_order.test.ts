import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  type KalshiAmendOrderV2Params,
  kalshiAmendOrderTool,
  kalshiAmendOrderV2Tool,
} from '@/tools/kalshi/amend_order'
import type { ToolResponse } from '@/tools/types'

const ORDER_ID = '3b23c1c7-f4ef-4f0d-8b9a-9e53c61f1a0d'

/** AmendOrderV2Request and AmendOrderV2Response examples from Kalshi's openapi.yaml. */
const AMEND_V2_REQUEST_EXAMPLE = {
  ticker: 'HIGHNY-24JAN01-T60',
  side: 'bid',
  price: '0.5700',
  count: '8.00',
  client_order_id: '8c35ecb3-328f-4f52-8c7c-0f4b9862f8d1',
  updated_client_order_id: '2a0e3fc9-b593-4aa3-96e5-82f7f7566c2a',
}
const AMEND_V2_RESPONSE_EXAMPLE = {
  order_id: ORDER_ID,
  client_order_id: '2a0e3fc9-b593-4aa3-96e5-82f7f7566c2a',
  remaining_count: '8.00',
  fill_count: '0.00',
  ts_ms: 1715793690123,
}
/** A resting order as GET /portfolio/orders/{id} returns it: 2 of 8 contracts filled. */
const CURRENT_ORDER = {
  order_id: ORDER_ID,
  ticker: 'HIGHNY-24JAN01-T60',
  outcome_side: 'yes',
  book_side: 'bid',
  status: 'resting',
  yes_price_dollars: '0.5600',
  no_price_dollars: '0.4400',
  fill_count_fp: '2.00',
  remaining_count_fp: '6.00',
  initial_count_fp: '8.00',
}

const { privateKey: ED25519_KEY, publicKey: ED25519_PUBLIC } = crypto.generateKeyPairSync('ed25519')

const BASE: KalshiAmendOrderV2Params = {
  keyId: 'key-id',
  privateKey: ED25519_KEY.export({ type: 'pkcs8', format: 'pem' }).toString(),
  orderId: ORDER_ID,
  ticker: 'HIGHNY-24JAN01-T60',
  side: 'yes',
  action: 'buy',
}

interface SentRequest {
  method: string
  path: string
  body: unknown
  signatureValid: boolean
}

/** Builds a tool's real request for `params`, the way the executor would send it. */
function sentRequest(
  tool: typeof kalshiAmendOrderV2Tool | typeof kalshiAmendOrderTool,
  params: KalshiAmendOrderV2Params
): SentRequest {
  const { url, method, headers, body } = tool.request
  if (typeof url !== 'function' || typeof headers !== 'function' || typeof method !== 'function') {
    throw new Error('amend tool has no request builders')
  }
  const path = new URL(url(params)).pathname
  const sent = headers(params)
  const verb = method(params)
  return {
    method: verb,
    path,
    body: body?.(params),
    signatureValid: crypto.verify(
      null,
      Buffer.from(`${sent['KALSHI-ACCESS-TIMESTAMP']}${verb}${path}`),
      ED25519_PUBLIC,
      Buffer.from(sent['KALSHI-ACCESS-SIGNATURE'], 'base64')
    ),
  }
}

/** Runs the amend that postProcess sends through the same tool, answering it with `reply`. */
function amendBoundary(tool: typeof kalshiAmendOrderV2Tool | typeof kalshiAmendOrderTool) {
  const sent: SentRequest[] = []
  const executeTool = async (
    _toolId: string,
    params: Record<string, unknown>
  ): Promise<ToolResponse> => {
    const typed = params as unknown as KalshiAmendOrderV2Params
    sent.push(sentRequest(tool, typed))
    const transform = tool.transformResponse
    if (!transform) throw new Error('transformResponse missing')
    return transform(Response.json(AMEND_V2_RESPONSE_EXAMPLE), typed)
  }
  return { sent, executeTool }
}

describe('Kalshi amend order on the V2 event-order endpoint', () => {
  it("sends the spec's AmendOrderV2Request example when count and price are given", () => {
    const request = sentRequest(kalshiAmendOrderV2Tool, {
      ...BASE,
      count: '8',
      yesPrice: '57',
      clientOrderId: AMEND_V2_REQUEST_EXAMPLE.client_order_id,
      updatedClientOrderId: AMEND_V2_REQUEST_EXAMPLE.updated_client_order_id,
    })
    expect(request).toEqual({
      method: 'POST',
      path: `/trade-api/v2/portfolio/events/orders/${ORDER_ID}/amend`,
      body: AMEND_V2_REQUEST_EXAMPLE,
      signatureValid: true,
    })
  })

  it('quotes a no-side amend on the YES book', () => {
    const request = sentRequest(kalshiAmendOrderTool, {
      ...BASE,
      side: 'no',
      action: 'buy',
      count: '8',
      noPrice: '43',
    })
    expect(request.body).toMatchObject({ side: 'ask', price: '0.5700', count: '8.00' })
  })

  it.each([
    ['kalshi_amend_order', kalshiAmendOrderTool],
    ['kalshi_amend_order_v2', kalshiAmendOrderV2Tool],
  ] as const)(
    '%s reads the order first, then amends a price-only change with its current total',
    async (_, tool) => {
      const params = { ...BASE, yesPrice: '57' }
      expect(sentRequest(tool, params)).toEqual({
        method: 'GET',
        path: `/trade-api/v2/portfolio/orders/${ORDER_ID}`,
        body: undefined,
        signatureValid: true,
      })

      const read = await tool.transformResponse?.(Response.json({ order: CURRENT_ORDER }), params)
      const postProcess = tool.postProcess
      if (!read || !postProcess) throw new Error('amend tool cannot read the order')
      const boundary = amendBoundary(tool)
      const result = await postProcess(read as never, params, boundary.executeTool)

      expect(boundary.sent).toEqual([
        {
          method: 'POST',
          path: `/trade-api/v2/portfolio/events/orders/${ORDER_ID}/amend`,
          body: { ticker: BASE.ticker, side: 'bid', price: '0.5700', count: '8.00' },
          signatureValid: true,
        },
      ])
      expect(result.success).toBe(true)
      expect(result.output.order).toMatchObject({
        order_id: ORDER_ID,
        remaining_count: 8,
        count: 8,
        yes_price_dollars: '0.5700',
      })
    }
  )

  it("keeps the order's current price on a count-only amend and reports the order before it", async () => {
    const params = { ...BASE, count: '10' }
    const read = await kalshiAmendOrderV2Tool.transformResponse?.(
      Response.json({ order: CURRENT_ORDER }),
      params
    )
    const postProcess = kalshiAmendOrderV2Tool.postProcess
    if (!read || !postProcess) throw new Error('amend tool cannot read the order')
    const boundary = amendBoundary(kalshiAmendOrderV2Tool)
    const result = await postProcess(read, params, boundary.executeTool)

    expect(boundary.sent[0].body).toEqual({
      ticker: BASE.ticker,
      side: 'bid',
      price: '0.5600',
      count: '10.00',
    })
    expect(result.output.old_order).toMatchObject({
      order_id: ORDER_ID,
      status: 'resting',
      fill_count_fp: '2.00',
      remaining_count_fp: '6.00',
    })
  })
})
