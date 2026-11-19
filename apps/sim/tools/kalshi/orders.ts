import { toRecord } from '@sim/utils/object'
import { buildKalshiUrl } from '@/tools/kalshi/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Kalshi's V2 event-order API (`/portfolio/events/orders`). Kalshi removed the legacy
 * `/portfolio/orders` write endpoints (410 `deprecated_v1_order_endpoint`), so the order tools keep
 * their legacy params (side yes/no, action buy/sell, cents or dollar prices) and translate them
 * here. V2 quotes every order from the YES leg: `bid` buys YES, `ask` sells YES, and buying NO at
 * `p` is selling YES at `1 - p` (BookSide in Kalshi's OpenAPI spec, and the order-direction guide).
 */

/** Fixed-point dollar prices carry at most 4 decimals; counts carry at most 2. */
const PRICE_DECIMALS = 4
const COUNT_DECIMALS = 2
const ONE_DOLLAR = 10 ** PRICE_DECIMALS

const TIME_IN_FORCE_VALUES = ['good_till_canceled', 'fill_or_kill', 'immediate_or_cancel']
const SELF_TRADE_PREVENTION_VALUES = ['taker_at_cross', 'maker']

/** What the legacy create and amend tools accept; every field arrives as text or an agent value. */
export interface KalshiLegacyOrderParams {
  ticker: string
  side: string
  action: string
  count?: string
  countFp?: string
  type?: string
  yesPrice?: string
  noPrice?: string
  yesPriceDollars?: string
  noPriceDollars?: string
  clientOrderId?: string
  updatedClientOrderId?: string
  expirationTs?: string
  timeInForce?: string
  buyMaxCost?: string
  postOnly?: string
  reduceOnly?: string
  selfTradePreventionType?: string
  orderGroupId?: string
  cancelOrderOnPause?: string
  subaccount?: string
}

function isBlank(value: unknown): boolean {
  return value == null || String(value).trim() === ''
}

/** Parses a non-negative decimal into integer units of `10^-decimals`, so prices never round. */
function parseScaled(value: unknown, decimals: number, label: string): number {
  const text = String(value).trim()
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match || (match[2]?.length ?? 0) > decimals) {
    throw new Error(
      `${label} must be a number with at most ${decimals} decimal places, got "${text}"`
    )
  }
  return Number(match[1]) * 10 ** decimals + Number((match[2] ?? '').padEnd(decimals, '0'))
}

/**
 * {@link parseScaled} for a value Kalshi returned: responses may emit up to 6 decimals, so zeros
 * past `decimals` are dropped ("0.560000" reads as "0.5600"). Real precision beyond it is rejected.
 */
function parseResponseScaled(value: unknown, decimals: number, label: string): number {
  const text = String(value ?? '').trim()
  const fraction = /\.(\d+)$/.exec(text)?.[1] ?? ''
  const trimmed =
    fraction.length > decimals && /^0+$/.test(fraction.slice(decimals))
      ? text.slice(0, text.length - (fraction.length - decimals))
      : text
  return parseScaled(trimmed, decimals, label)
}

function formatScaled(units: number, decimals: number): string {
  const scale = 10 ** decimals
  return `${Math.floor(units / scale)}.${String(units % scale).padStart(decimals, '0')}`
}

function oneOf(value: unknown, allowed: string[], fallback: string, label: string): string {
  if (isBlank(value)) return fallback
  const text = String(value).trim().toLowerCase()
  if (!allowed.includes(text)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}, got "${text}"`)
  }
  return text
}

/**
 * `undefined` when unset, so an untouched field sends nothing; `'false'` stays an explicit false.
 * Anything other than true or false throws, so a typo never drops a requested safety restriction.
 */
function optionalFlag(value: unknown, label: string): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (isBlank(value)) return undefined
  const text = String(value).trim().toLowerCase()
  if (text === 'true') return true
  if (text === 'false') return false
  throw new Error(`${label} must be true or false, got "${String(value).trim()}"`)
}

/** The V2 book side for a legacy (side, action): buy yes and sell no bid; buy no and sell yes ask. */
function kalshiBookSide(side: unknown, action: unknown): 'bid' | 'ask' {
  const outcome = oneOf(side, ['yes', 'no'], '', 'Side')
  const direction = oneOf(action, ['buy', 'sell'], '', 'Action')
  if (!outcome) throw new Error('Side is required: yes or no')
  if (!direction) throw new Error('Action is required: buy or sell')
  return (direction === 'buy') === (outcome === 'yes') ? 'bid' : 'ask'
}

/**
 * The YES-leg price in `10^-4` dollar units from whichever legacy price was set. A no price `q`
 * is the YES price `1 - q`. Returns `undefined` when no price is set.
 */
function yesPriceUnits(params: KalshiLegacyOrderParams): number | undefined {
  const candidates: number[] = []
  if (!isBlank(params.yesPrice))
    candidates.push(parseScaled(params.yesPrice, 2, 'Yes Price (cents)'))
  if (!isBlank(params.noPrice)) {
    candidates.push(ONE_DOLLAR - parseScaled(params.noPrice, 2, 'No Price (cents)'))
  }
  if (!isBlank(params.yesPriceDollars)) {
    candidates.push(parseScaled(params.yesPriceDollars, PRICE_DECIMALS, 'Yes Price (dollars)'))
  }
  if (!isBlank(params.noPriceDollars)) {
    candidates.push(
      ONE_DOLLAR - parseScaled(params.noPriceDollars, PRICE_DECIMALS, 'No Price (dollars)')
    )
  }
  if (candidates.length === 0) return undefined
  if (candidates.some((units) => units !== candidates[0])) {
    throw new Error('The yes and no prices given describe different prices; set only one price')
  }
  if (candidates[0] <= 0 || candidates[0] >= ONE_DOLLAR) {
    throw new Error('Price must be between 1 and 99 cents')
  }
  return candidates[0]
}

/** The order's contracts as a fixed-point count, from `count` or `countFp`, which must agree. */
function fixedPointCount(params: KalshiLegacyOrderParams): string | undefined {
  const counts = [params.count, params.countFp]
    .filter((value) => !isBlank(value))
    .map((value) => parseScaled(value, COUNT_DECIMALS, 'Contracts'))
  if (counts.length === 0) return undefined
  if (counts.some((units) => units !== counts[0])) {
    throw new Error('Contracts and Contracts (Fixed-Point) disagree; set only one')
  }
  if (counts[0] <= 0) throw new Error('Contracts must be greater than 0')
  return formatScaled(counts[0], COUNT_DECIMALS)
}

function requiredTicker(ticker: unknown): string {
  if (isBlank(ticker)) throw new Error('Market Ticker is required')
  return String(ticker).trim()
}

/** `POST /portfolio/events/orders` body (CreateOrderV2Request) for a legacy create. */
export function buildKalshiCreateOrderBody(
  params: KalshiLegacyOrderParams
): Record<string, unknown> {
  const type = oneOf(params.type, ['limit', 'market'], 'limit', 'Order Type')
  if (type === 'market') {
    throw new Error(
      'Kalshi no longer accepts market orders (removed 2026-02-11). Place a limit order with a price instead, for example a Yes Price of 99 to buy at up to 99 cents.'
    )
  }
  if (!isBlank(params.buyMaxCost)) {
    throw new Error(
      "Kalshi's order API no longer accepts Max Cost. Set a limit price and count with Time in Force fill_or_kill instead."
    )
  }
  const count = fixedPointCount(params)
  if (!count) throw new Error('Contracts is required')
  const price = yesPriceUnits(params)
  if (price === undefined) {
    throw new Error(
      'A price is required: set Yes Price or No Price (Kalshi accepts only limit orders)'
    )
  }

  const body: Record<string, unknown> = {
    ticker: requiredTicker(params.ticker),
    side: kalshiBookSide(params.side, params.action),
    count,
    price: formatScaled(price, PRICE_DECIMALS),
    // Without an expiration, good_till_canceled rests until canceled, as the legacy default did.
    time_in_force: oneOf(
      params.timeInForce,
      TIME_IN_FORCE_VALUES,
      'good_till_canceled',
      'Time in Force'
    ),
    self_trade_prevention_type: oneOf(
      params.selfTradePreventionType,
      SELF_TRADE_PREVENTION_VALUES,
      'taker_at_cross',
      'Self-Trade Prevention'
    ),
  }
  if (!isBlank(params.clientOrderId)) body.client_order_id = params.clientOrderId
  if (!isBlank(params.expirationTs)) {
    body.expiration_time = parseScaled(params.expirationTs, 0, 'Expiration')
  }
  const postOnly = optionalFlag(params.postOnly, 'Post Only')
  if (postOnly !== undefined) body.post_only = postOnly
  const reduceOnly = optionalFlag(params.reduceOnly, 'Reduce Only')
  if (reduceOnly !== undefined) body.reduce_only = reduceOnly
  const cancelOnPause = optionalFlag(params.cancelOrderOnPause, 'Cancel Order on Pause')
  if (cancelOnPause !== undefined) body.cancel_order_on_pause = cancelOnPause
  if (!isBlank(params.orderGroupId)) body.order_group_id = params.orderGroupId
  const subaccount = kalshiSubaccount(params.subaccount)
  if (subaccount !== undefined) body.subaccount = subaccount
  return body
}

/**
 * Whether an amend must first read the order: V2 requires the total `count` and the `price` on
 * every amend, while the legacy amend let either be left out.
 */
export function kalshiAmendNeedsCurrentOrder(params: KalshiLegacyOrderParams): boolean {
  return fixedPointCount(params) === undefined || yesPriceUnits(params) === undefined
}

/**
 * `POST /portfolio/events/orders/{id}/amend` body (AmendOrderV2Request). `count` is the order's
 * new total (filled plus resting), which is also what the legacy amend's count meant.
 */
export function buildKalshiAmendOrderBody(
  params: KalshiLegacyOrderParams
): Record<string, unknown> {
  const count = fixedPointCount(params)
  const price = yesPriceUnits(params)
  if (!count || price === undefined) throw new Error('Amend needs the order count and price')
  const body: Record<string, unknown> = {
    ticker: requiredTicker(params.ticker),
    side: kalshiBookSide(params.side, params.action),
    price: formatScaled(price, PRICE_DECIMALS),
    count,
  }
  if (!isBlank(params.clientOrderId)) body.client_order_id = params.clientOrderId
  if (!isBlank(params.updatedClientOrderId)) {
    body.updated_client_order_id = params.updatedClientOrderId
  }
  return body
}

/**
 * Fills an amend's missing count and price from the order as Kalshi returns it (GetOrderResponse
 * `order`): the total is `fill_count_fp + remaining_count_fp`, and the price is its YES price.
 */
export function kalshiAmendParamsFromOrder<P extends KalshiLegacyOrderParams>(
  params: P,
  order: unknown
): P {
  const current = toRecord(order)
  const next: P = { ...params }
  if (fixedPointCount(params) === undefined) {
    const filled = parseResponseScaled(current.fill_count_fp, COUNT_DECIMALS, 'Order fill count')
    const resting = parseResponseScaled(
      current.remaining_count_fp,
      COUNT_DECIMALS,
      'Order remaining count'
    )
    next.count = undefined
    next.countFp = formatScaled(filled + resting, COUNT_DECIMALS)
  }
  if (yesPriceUnits(params) === undefined) {
    next.yesPrice = undefined
    next.noPrice = undefined
    next.noPriceDollars = undefined
    next.yesPriceDollars = formatScaled(
      parseResponseScaled(current.yes_price_dollars, PRICE_DECIMALS, 'Order yes price'),
      PRICE_DECIMALS
    )
  }
  return next
}

/** Path of an order write: the create collection, or one order's cancel or amend. */
export function kalshiOrderPath(orderId?: string, action?: 'amend'): string {
  if (orderId === undefined) return '/portfolio/events/orders'
  const order = `/portfolio/events/orders/${safeUrlPathSegment(orderId, 'orderId')}`
  return action ? `${order}/${action}` : order
}

/** The subaccount number (0 primary, 1-63 numbered), or `undefined` when unset. */
function kalshiSubaccount(value: unknown): number | undefined {
  return isBlank(value) ? undefined : parseScaled(value, 0, 'Subaccount')
}

/**
 * A cancel or amend URL with its query: `subaccount` (CancelOrderV2 and AmendOrderV2 take it as a
 * query param) and any extra params. Kalshi signs the path only, never the query.
 */
export function kalshiOrderWriteUrl(
  path: string,
  subaccount: unknown,
  query: Record<string, string> = {}
): string {
  const search = new URLSearchParams(query)
  const number = kalshiSubaccount(subaccount)
  if (number !== undefined) search.set('subaccount', String(number))
  const text = search.toString()
  return text ? `${buildKalshiUrl(path)}?${text}` : buildKalshiUrl(path)
}

/** The optional `subaccount` param of the cancel and amend tools. */
export const KALSHI_ORDER_SUBACCOUNT_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description:
    'Subaccount the order belongs to (0 for primary, 1-63 for numbered subaccounts). Leave empty for the primary account',
} as const

/** Path of the documented order read (`GET /portfolio/orders/{id}`). */
export function kalshiOrderReadPath(orderId: string): string {
  return `/portfolio/orders/${safeUrlPathSegment(orderId, 'orderId')}`
}

/** A V2 fixed-point count string ("10.00") as a number, or `null` when absent. */
export function kalshiCountNumber(value: unknown): number | null {
  if (isBlank(value)) return null
  const count = Number(value)
  return Number.isFinite(count) ? count : null
}

/**
 * The legacy order fields a V2 create or amend can fill: its identity and counts from Kalshi's
 * response, and the direction and price this request sent. Everything else is unknown.
 */
export function kalshiWrittenOrder(
  data: unknown,
  params: KalshiLegacyOrderParams,
  body: Record<string, unknown>
) {
  const response = toRecord(data)
  const price = typeof body.price === 'string' ? body.price : null
  const yesUnits = price === null ? null : parseScaled(price, PRICE_DECIMALS, 'Price')
  const fillCount = typeof response.fill_count === 'string' ? response.fill_count : null
  const remainingCount =
    typeof response.remaining_count === 'string' ? response.remaining_count : null
  return {
    order_id: typeof response.order_id === 'string' ? response.order_id : null,
    client_order_id: typeof response.client_order_id === 'string' ? response.client_order_id : null,
    ticker: typeof body.ticker === 'string' ? body.ticker : null,
    side: String(params.side).trim().toLowerCase(),
    action: String(params.action).trim().toLowerCase(),
    type: 'limit',
    yes_price_dollars: price,
    no_price_dollars:
      yesUnits === null ? null : formatScaled(ONE_DOLLAR - yesUnits, PRICE_DECIMALS),
    fill_count: kalshiCountNumber(fillCount),
    fill_count_fp: fillCount,
    remaining_count: kalshiCountNumber(remainingCount),
    remaining_count_fp: remainingCount,
    initial_count_fp: typeof body.count === 'string' ? body.count : null,
    /** When Kalshi's matching engine processed this write. */
    processed_time:
      typeof response.ts_ms === 'number' ? new Date(response.ts_ms).toISOString() : null,
    self_trade_prevention_type:
      typeof body.self_trade_prevention_type === 'string' ? body.self_trade_prevention_type : null,
    order_group_id: typeof body.order_group_id === 'string' ? body.order_group_id : null,
    cancel_order_on_pause:
      typeof body.cancel_order_on_pause === 'boolean' ? body.cancel_order_on_pause : null,
  }
}

/** Every key of the order object the legacy write endpoints returned (`KalshiOrder`). */
const LEGACY_ORDER_KEYS = [
  'order_id',
  'ticker',
  'event_ticker',
  'status',
  'side',
  'type',
  'yes_price',
  'no_price',
  'action',
  'count',
  'remaining_count',
  'created_time',
  'expiration_time',
  'place_count',
  'decrease_count',
  'maker_fill_count',
  'taker_fill_count',
  'taker_fees',
] as const

/**
 * The legacy `order` output for a V2 write: every key the removed endpoints returned stays present,
 * as `null` when Kalshi's V2 response no longer reports it, so a saved reference resolves to null
 * rather than disappearing.
 */
export function kalshiLegacyOrder(order: Record<string, unknown>): Record<string, unknown> {
  const legacy: Record<string, unknown> = {}
  for (const key of LEGACY_ORDER_KEYS) legacy[key] = null
  return { ...legacy, ...order }
}
