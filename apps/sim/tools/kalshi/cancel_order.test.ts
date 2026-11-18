import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { KalshiBlock } from '@/blocks/blocks/kalshi'
import {
  type KalshiCancelOrderV2Params,
  kalshiCancelOrderTool,
  kalshiCancelOrderV2Tool,
} from '@/tools/kalshi/cancel_order'
import type { ToolResponse } from '@/tools/types'

const ORDER_ID = '3b23c1c7-f4ef-4f0d-8b9a-9e53c61f1a0d'
const TICKER = 'KXBTC-24DEC31'

/** Kalshi's CancelOrderV2Response example (docs.kalshi.com openapi.yaml). */
const CANCEL_V2_EXAMPLE = {
  order_id: ORDER_ID,
  client_order_id: '8c35ecb3-328f-4f52-8c7c-0f4b9862f8d1',
  reduced_by: '10.00',
  ts_ms: 1715793660456,
}

const { privateKey: ED25519_KEY, publicKey: ED25519_PUBLIC } = crypto.generateKeyPairSync('ed25519')

const BASE: KalshiCancelOrderV2Params = {
  keyId: 'key-id',
  privateKey: ED25519_KEY.export({ type: 'pkcs8', format: 'pem' }).toString(),
  orderId: ORDER_ID,
}

const TOOLS = [
  ['kalshi_cancel_order', kalshiCancelOrderTool],
  ['kalshi_cancel_order_v2', kalshiCancelOrderV2Tool],
] as const

type CancelTool = (typeof TOOLS)[number][1]

interface SentRequest {
  method: string
  path: string
  marketTicker: string | null
  signatureValid: boolean
}

/** Builds a cancel tool's real request, checking the signature covers the path alone. */
function sentRequest(tool: CancelTool, params: KalshiCancelOrderV2Params): SentRequest {
  const { url, method, headers } = tool.request
  if (typeof url !== 'function' || typeof method !== 'function' || typeof headers !== 'function') {
    throw new Error('cancel tool has no request builders')
  }
  const requestUrl = new URL(url(params))
  const verb = method(params)
  const sent = headers(params)
  return {
    method: verb,
    path: requestUrl.pathname,
    marketTicker: requestUrl.searchParams.get('market_ticker'),
    signatureValid: crypto.verify(
      null,
      Buffer.from(`${sent['KALSHI-ACCESS-TIMESTAMP']}${verb}${requestUrl.pathname}`),
      ED25519_PUBLIC,
      Buffer.from(sent['KALSHI-ACCESS-SIGNATURE'], 'base64')
    ),
  }
}

/** Reads the order with `tool`, as Kalshi answers the read that precedes a ticker-less cancel. */
async function readOrder(tool: CancelTool) {
  const read = await tool.transformResponse?.(
    Response.json({ order: { order_id: ORDER_ID, ticker: TICKER, status: 'resting' } }),
    BASE
  )
  const postProcess = tool.postProcess
  if (!read || !postProcess) throw new Error('cancel tool cannot read the order')
  return { read, postProcess }
}

describe('Kalshi cancel order routes to the order shard by ticker', () => {
  it.each(TOOLS)('%s deletes /portfolio/events/orders/{id}?market_ticker=…', (_, tool) => {
    expect(sentRequest(tool, { ...BASE, ticker: ` ${TICKER} ` })).toEqual({
      method: 'DELETE',
      path: `/trade-api/v2/portfolio/events/orders/${ORDER_ID}`,
      marketTicker: TICKER,
      signatureValid: true,
    })
  })

  it.each(TOOLS)(
    '%s reads the order first when no ticker is given, then cancels with its ticker',
    async (_, tool) => {
      expect(sentRequest(tool, BASE)).toEqual({
        method: 'GET',
        path: `/trade-api/v2/portfolio/orders/${ORDER_ID}`,
        marketTicker: null,
        signatureValid: true,
      })

      const { read, postProcess } = await readOrder(tool)
      const sent: SentRequest[] = []
      const executeTool = async (
        _toolId: string,
        params: Record<string, unknown>
      ): Promise<ToolResponse> => {
        const typed = params as unknown as KalshiCancelOrderV2Params
        sent.push(sentRequest(tool, typed))
        const transform = tool.transformResponse
        if (!transform) throw new Error('transformResponse missing')
        return transform(Response.json(CANCEL_V2_EXAMPLE), typed)
      }
      const result = await postProcess(read as never, BASE, executeTool)

      expect(sent).toEqual([
        {
          method: 'DELETE',
          path: `/trade-api/v2/portfolio/events/orders/${ORDER_ID}`,
          marketTicker: TICKER,
          signatureValid: true,
        },
      ])
      expect(result.success).toBe(true)
      expect(result.output.order).toMatchObject({ order_id: ORDER_ID, ticker: TICKER })
    }
  )

  it.each(TOOLS)(
    '%s reports a failed cancel, not the successful read, when the cancel throws',
    async (_, tool) => {
      const { read, postProcess } = await readOrder(tool)
      const result = await postProcess(read as never, BASE, async () => {
        throw new Error('network down')
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('network down')
    }
  )

  it('maps the V2 cancel response onto the original outputs', async () => {
    const params = { ...BASE, ticker: TICKER }
    const v1 = await kalshiCancelOrderTool.transformResponse?.(
      Response.json(CANCEL_V2_EXAMPLE),
      params
    )
    expect(v1?.output.reducedBy).toBe(10)
    expect(v1?.output.order).toMatchObject({
      order_id: ORDER_ID,
      client_order_id: CANCEL_V2_EXAMPLE.client_order_id,
      ticker: TICKER,
      // Keys the legacy order object had stay present, as null, so saved references resolve.
      event_ticker: null,
      status: null,
      count: null,
    })

    const v2 = await kalshiCancelOrderV2Tool.transformResponse?.(
      Response.json(CANCEL_V2_EXAMPLE),
      params
    )
    expect(v2?.output.order).toMatchObject({
      order_id: ORDER_ID,
      client_order_id: CANCEL_V2_EXAMPLE.client_order_id,
      ticker: TICKER,
      status: null,
    })
    expect(v2?.output.reduced_by).toBe(10)
    expect(v2?.output.reduced_by_fp).toBe('10.00')
  })
})

describe('Kalshi cancel order on a subaccount', () => {
  const query = (tool: CancelTool, params: KalshiCancelOrderV2Params) => {
    const { url } = tool.request
    if (typeof url !== 'function') throw new Error('cancel tool has no url builder')
    return new URL(url(params)).searchParams
  }

  it.each(TOOLS)('%s sends the subaccount on the cancel, not on the order read', (_, tool) => {
    expect(query(tool, { ...BASE, ticker: TICKER, subaccount: '2' }).get('subaccount')).toBe('2')
    expect(query(tool, { ...BASE, subaccount: '2' }).has('subaccount')).toBe(false)
    expect(query(tool, { ...BASE, ticker: TICKER }).has('subaccount')).toBe(false)
    expect(sentRequest(tool, { ...BASE, ticker: TICKER, subaccount: '2' }).signatureValid).toBe(
      true
    )
  })

  it.each(TOOLS)(
    '%s keeps the subaccount on the cancel it sends after the order read',
    async (_, tool) => {
      const { read, postProcess } = await readOrder(tool)
      const forwarded: Array<URLSearchParams> = []
      await postProcess(read as never, { ...BASE, subaccount: '2' }, async (_toolId, params) => {
        forwarded.push(query(tool, params as unknown as KalshiCancelOrderV2Params))
        return { success: true, output: {} }
      })
      expect(forwarded.map((search) => search.get('subaccount'))).toEqual(['2'])
    }
  )

  it.each(TOOLS)('%s refuses a subaccount that is not a whole number', (_, tool) => {
    expect(() => query(tool, { ...BASE, ticker: TICKER, subaccount: 'two' })).toThrow(/Subaccount/)
  })
})

describe('Kalshi block cancel ticker', () => {
  const mapped = (stored: Record<string, unknown>) => {
    const inputs: Record<string, unknown> = {
      operation: 'cancel_order',
      orderIdParam: ORDER_ID,
      ...stored,
    }
    return { ...inputs, ...KalshiBlock.tools.config?.params?.(inputs) }
  }

  it('sends its own ticker field, never a ticker left from another operation', () => {
    expect(mapped({ cancelTicker: TICKER, ticker: 'OTHER-MARKET' }).ticker).toBe(TICKER)
    expect(mapped({ cancelTicker: '', ticker: 'OTHER-MARKET' }).ticker).toBeUndefined()
  })
})
