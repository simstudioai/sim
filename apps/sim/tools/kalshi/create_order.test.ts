import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { KalshiBlock } from '@/blocks/blocks/kalshi'
import {
  type KalshiCreateOrderV2Params,
  kalshiCreateOrderTool,
  kalshiCreateOrderV2Tool,
} from '@/tools/kalshi/create_order'

/** CreateOrderV2Request and CreateOrderV2Response examples from Kalshi's openapi.yaml. */
const CREATE_V2_REQUEST_EXAMPLE = {
  ticker: 'HIGHNY-24JAN01-T60',
  client_order_id: '8c35ecb3-328f-4f52-8c7c-0f4b9862f8d1',
  side: 'bid',
  count: '10.00',
  price: '0.5600',
  time_in_force: 'good_till_canceled',
  self_trade_prevention_type: 'taker_at_cross',
  post_only: false,
  cancel_order_on_pause: false,
  reduce_only: false,
  subaccount: 0,
}
const CREATE_V2_RESPONSE_EXAMPLE = {
  order_id: '3b23c1c7-f4ef-4f0d-8b9a-9e53c61f1a0d',
  client_order_id: '8c35ecb3-328f-4f52-8c7c-0f4b9862f8d1',
  fill_count: '0.00',
  remaining_count: '10.00',
  ts_ms: 1715793600123,
}

const { privateKey: ED25519_KEY, publicKey: ED25519_PUBLIC } = crypto.generateKeyPairSync('ed25519')
const PRIVATE_PEM = ED25519_KEY.export({ type: 'pkcs8', format: 'pem' }).toString()

const BASE: KalshiCreateOrderV2Params = {
  keyId: 'key-id',
  privateKey: PRIVATE_PEM,
  ticker: 'HIGHNY-24JAN01-T60',
  side: 'yes',
  action: 'buy',
  count: '10',
}

function createBody(params: Partial<KalshiCreateOrderV2Params>) {
  const body = kalshiCreateOrderV2Tool.request.body
  if (!body) throw new Error('create tool has no body builder')
  return body({ ...BASE, ...params }) as Record<string, unknown>
}

describe('Kalshi create order on the V2 event-order endpoint', () => {
  it("sends the spec's CreateOrderV2Request example for a legacy buy-yes limit order", () => {
    expect(
      createBody({
        clientOrderId: CREATE_V2_REQUEST_EXAMPLE.client_order_id,
        yesPrice: '56',
        postOnly: 'false',
        reduceOnly: 'false',
        cancelOrderOnPause: 'false',
        subaccount: '0',
      })
    ).toEqual(CREATE_V2_REQUEST_EXAMPLE)
  })

  it.each([
    ['buy', 'yes', { yesPrice: '56' }, 'bid', '0.5600'],
    ['sell', 'yes', { yesPrice: '56' }, 'ask', '0.5600'],
    ['buy', 'no', { noPrice: '44' }, 'ask', '0.5600'],
    ['sell', 'no', { noPrice: '44' }, 'bid', '0.5600'],
    ['buy', 'no', { noPriceDollars: '0.4425' }, 'ask', '0.5575'],
    ['sell', 'yes', { yesPriceDollars: '0.56' }, 'ask', '0.5600'],
  ])('%s %s at %j quotes the YES book as %s at %s', (action, side, price, bookSide, yesPrice) => {
    const body = createBody({ action, side, ...price })
    expect(body.side).toBe(bookSide)
    expect(body.price).toBe(yesPrice)
  })

  it('keeps a legacy order without time in force or self-trade prevention resting until canceled', () => {
    for (const unset of [undefined, '', null]) {
      const body = createBody({
        yesPrice: '56',
        timeInForce: unset as string | undefined,
        selfTradePreventionType: unset as string | undefined,
      })
      expect(body.time_in_force).toBe('good_till_canceled')
      expect(body.self_trade_prevention_type).toBe('taker_at_cross')
      expect(body).not.toHaveProperty('expiration_time')
    }
    const set = createBody({
      yesPrice: '56',
      timeInForce: 'immediate_or_cancel',
      selfTradePreventionType: 'maker',
      expirationTs: '1715800000',
    })
    expect(set).toMatchObject({
      time_in_force: 'immediate_or_cancel',
      self_trade_prevention_type: 'maker',
      expiration_time: 1715800000,
    })
  })

  it('refuses a market order and a max cost, which Kalshi no longer accepts', () => {
    expect(() => createBody({ type: 'market', yesPrice: '56' })).toThrow(
      /no longer accepts market orders.*limit order with a price/
    )
    expect(() => createBody({ yesPrice: '56', buyMaxCost: '500' })).toThrow(
      /no longer accepts Max Cost.*fill_or_kill/
    )
    expect(() => createBody({})).toThrow(/price is required/)
    expect(() => createBody({ yesPrice: '56', noPrice: '50' })).toThrow(/different prices/)
  })

  it('refuses an order flag that is neither true nor false instead of dropping the restriction', () => {
    expect(() => createBody({ yesPrice: '56', postOnly: 'ture' })).toThrow(
      /Post Only must be true or false, got "ture"/
    )
    expect(() => createBody({ yesPrice: '56', reduceOnly: 'yes' })).toThrow(/Reduce Only/)
    expect(() => createBody({ yesPrice: '56', cancelOrderOnPause: '1' })).toThrow(
      /Cancel Order on Pause/
    )
    expect(
      createBody({
        yesPrice: '56',
        postOnly: ' TRUE ',
        reduceOnly: true as unknown as string,
        cancelOrderOnPause: 'False',
      })
    ).toMatchObject({ post_only: true, reduce_only: true, cancel_order_on_pause: false })
    expect(createBody({ yesPrice: '56', postOnly: '' })).not.toHaveProperty('post_only')
  })

  it('posts to /portfolio/events/orders and signs that path', () => {
    const { url, headers } = kalshiCreateOrderTool.request
    if (typeof url !== 'function' || typeof headers !== 'function') {
      throw new Error('create tool has no request builders')
    }
    const params = { ...BASE, count: '10', yesPrice: '56' }
    const requestUrl = new URL(url(params))
    expect(requestUrl.pathname).toBe('/trade-api/v2/portfolio/events/orders')
    const sent = headers(params)
    expect(
      crypto.verify(
        null,
        Buffer.from(`${sent['KALSHI-ACCESS-TIMESTAMP']}POST${requestUrl.pathname}`),
        ED25519_PUBLIC,
        Buffer.from(sent['KALSHI-ACCESS-SIGNATURE'], 'base64')
      )
    ).toBe(true)
  })

  it('keeps every legacy order key on the v1 create output', async () => {
    const result = await kalshiCreateOrderTool.transformResponse?.(
      Response.json(CREATE_V2_RESPONSE_EXAMPLE, { status: 201 }),
      { ...BASE, count: '10', yesPrice: '56' }
    )
    expect(result?.output.order).toMatchObject({
      order_id: CREATE_V2_RESPONSE_EXAMPLE.order_id,
      ticker: 'HIGHNY-24JAN01-T60',
      count: 10,
      remaining_count: 10,
      event_ticker: null,
      status: null,
      yes_price: null,
      expiration_time: null,
      taker_fees: null,
    })
  })

  it('maps the CreateOrderV2Response example onto the order outputs', async () => {
    const params = { ...BASE, side: 'no', action: 'buy', noPrice: '44' }
    const result = await kalshiCreateOrderV2Tool.transformResponse?.(
      Response.json(CREATE_V2_RESPONSE_EXAMPLE, { status: 201 }),
      params
    )
    expect(result?.output.order).toMatchObject({
      order_id: CREATE_V2_RESPONSE_EXAMPLE.order_id,
      client_order_id: CREATE_V2_RESPONSE_EXAMPLE.client_order_id,
      ticker: 'HIGHNY-24JAN01-T60',
      side: 'no',
      action: 'buy',
      type: 'limit',
      status: null,
      yes_price_dollars: '0.5600',
      no_price_dollars: '0.4400',
      fill_count: 0,
      fill_count_fp: '0.00',
      remaining_count: 10,
      remaining_count_fp: '10.00',
      initial_count_fp: '10.00',
      created_time: new Date(CREATE_V2_RESPONSE_EXAMPLE.ts_ms).toISOString(),
      self_trade_prevention_type: 'taker_at_cross',
    })
  })
})

describe('Kalshi block Self-Trade Prevention', () => {
  const mapParams = (stored: Record<string, unknown>) => {
    const inputs = {
      operation: 'create_order',
      tickerOrder: 'HIGHNY-24JAN01-T60',
      side: 'yes',
      action: 'buy',
      count: '10',
      yesPrice: '56',
      ...stored,
    }
    return { ...inputs, ...KalshiBlock.tools.config?.params?.(inputs) } as Record<string, unknown>
  }

  it('sends the chosen Self-Trade Prevention and defaults to taker at cross', () => {
    expect(
      createBody(mapParams({ orderSelfTradePrevention: 'maker' })).self_trade_prevention_type
    ).toBe('maker')
    expect(createBody(mapParams({ orderSelfTradePrevention: '' })).self_trade_prevention_type).toBe(
      'taker_at_cross'
    )
  })
})
