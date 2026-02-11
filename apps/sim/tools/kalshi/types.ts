import crypto from 'crypto'
import type { OutputProperty } from '@/tools/types'

// Base URL for Kalshi API
export const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

/**
 * Output property definitions for Kalshi Trade API responses.
 * @see https://trading-api.readme.io/reference/introduction
 */

/**
 * Output definition for market objects.
 * @see https://trading-api.readme.io/reference/getmarkets
 */
export const KALSHI_MARKET_OUTPUT_PROPERTIES = {
  ticker: { type: 'string', description: 'Unique market ticker identifier' },
  event_ticker: { type: 'string', description: 'Parent event ticker' },
  market_type: { type: 'string', description: 'Market type (binary, etc.)' },
  title: { type: 'string', description: 'Market title/question' },
  subtitle: { type: 'string', description: 'Market subtitle', optional: true },
  yes_sub_title: { type: 'string', description: 'Yes outcome subtitle', optional: true },
  no_sub_title: { type: 'string', description: 'No outcome subtitle', optional: true },
  open_time: { type: 'string', description: 'Market open time (ISO 8601)', optional: true },
  close_time: { type: 'string', description: 'Market close time (ISO 8601)', optional: true },
  expiration_time: { type: 'string', description: 'Contract expiration time', optional: true },
  status: { type: 'string', description: 'Market status (open, closed, settled, etc.)' },
  yes_bid: { type: 'number', description: 'Current best yes bid price in cents', optional: true },
  yes_ask: { type: 'number', description: 'Current best yes ask price in cents', optional: true },
  no_bid: { type: 'number', description: 'Current best no bid price in cents', optional: true },
  no_ask: { type: 'number', description: 'Current best no ask price in cents', optional: true },
  last_price: { type: 'number', description: 'Last trade price in cents', optional: true },
  previous_yes_bid: { type: 'number', description: 'Previous yes bid', optional: true },
  previous_yes_ask: { type: 'number', description: 'Previous yes ask', optional: true },
  previous_price: { type: 'number', description: 'Previous last price', optional: true },
  volume: { type: 'number', description: 'Total volume (contracts traded)', optional: true },
  volume_24h: { type: 'number', description: '24-hour trading volume', optional: true },
  liquidity: { type: 'number', description: 'Market liquidity measure', optional: true },
  open_interest: {
    type: 'number',
    description: 'Open interest (outstanding contracts)',
    optional: true,
  },
  result: { type: 'string', description: 'Settlement result (yes, no, null)', optional: true },
  cap_strike: { type: 'number', description: 'Cap strike for ranged markets', optional: true },
  floor_strike: { type: 'number', description: 'Floor strike for ranged markets', optional: true },
  category: { type: 'string', description: 'Market category', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete market output definition
 */
export const KALSHI_MARKET_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi market object',
  properties: KALSHI_MARKET_OUTPUT_PROPERTIES,
}

/**
 * Output definition for event objects.
 * @see https://trading-api.readme.io/reference/getevents
 */
export const KALSHI_EVENT_OUTPUT_PROPERTIES = {
  event_ticker: { type: 'string', description: 'Unique event ticker identifier' },
  series_ticker: { type: 'string', description: 'Parent series ticker' },
  title: { type: 'string', description: 'Event title' },
  sub_title: { type: 'string', description: 'Event subtitle', optional: true },
  mutually_exclusive: { type: 'boolean', description: 'Whether markets are mutually exclusive' },
  category: { type: 'string', description: 'Event category' },
  strike_date: { type: 'string', description: 'Strike/settlement date', optional: true },
  status: { type: 'string', description: 'Event status', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete event output definition
 */
export const KALSHI_EVENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi event object',
  properties: KALSHI_EVENT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for order objects.
 * @see https://trading-api.readme.io/reference/getorders
 */
export const KALSHI_ORDER_OUTPUT_PROPERTIES = {
  order_id: { type: 'string', description: 'Unique order identifier' },
  user_id: { type: 'string', description: 'User ID', optional: true },
  client_order_id: { type: 'string', description: 'Client-provided order ID', optional: true },
  ticker: { type: 'string', description: 'Market ticker' },
  side: { type: 'string', description: 'Order side (yes/no)' },
  action: { type: 'string', description: 'Order action (buy/sell)' },
  type: { type: 'string', description: 'Order type (limit/market)' },
  status: { type: 'string', description: 'Order status (resting, canceled, executed)' },
  yes_price: { type: 'number', description: 'Yes price in cents', optional: true },
  no_price: { type: 'number', description: 'No price in cents', optional: true },
  fill_count: { type: 'number', description: 'Number of contracts filled', optional: true },
  remaining_count: { type: 'number', description: 'Remaining contracts to fill', optional: true },
  initial_count: { type: 'number', description: 'Initial order size', optional: true },
  taker_fees: { type: 'number', description: 'Taker fees paid in cents', optional: true },
  maker_fees: { type: 'number', description: 'Maker fees paid in cents', optional: true },
  created_time: { type: 'string', description: 'Order creation time (ISO 8601)', optional: true },
  expiration_time: { type: 'string', description: 'Order expiration time', optional: true },
  last_update_time: { type: 'string', description: 'Last order update time', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete order output definition
 */
export const KALSHI_ORDER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi order object',
  properties: KALSHI_ORDER_OUTPUT_PROPERTIES,
}

/**
 * Output definition for position objects.
 * @see https://trading-api.readme.io/reference/getpositions
 */
export const KALSHI_POSITION_OUTPUT_PROPERTIES = {
  ticker: { type: 'string', description: 'Market ticker' },
  event_ticker: { type: 'string', description: 'Event ticker' },
  event_title: { type: 'string', description: 'Event title', optional: true },
  market_title: { type: 'string', description: 'Market title', optional: true },
  position: { type: 'number', description: 'Net position (positive=yes, negative=no)' },
  market_exposure: {
    type: 'number',
    description: 'Maximum potential loss in cents',
    optional: true,
  },
  realized_pnl: { type: 'number', description: 'Realized profit/loss in cents', optional: true },
  total_traded: { type: 'number', description: 'Total contracts traded', optional: true },
  resting_orders_count: { type: 'number', description: 'Number of resting orders', optional: true },
  fees_paid: { type: 'number', description: 'Total fees paid in cents', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete position output definition
 */
export const KALSHI_POSITION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi market position object',
  properties: KALSHI_POSITION_OUTPUT_PROPERTIES,
}

/**
 * Output definition for event position objects.
 * @see https://trading-api.readme.io/reference/getpositions
 */
export const KALSHI_EVENT_POSITION_OUTPUT_PROPERTIES = {
  event_ticker: { type: 'string', description: 'Event ticker' },
  event_exposure: { type: 'number', description: 'Event-level exposure in cents' },
  realized_pnl: { type: 'number', description: 'Realized P&L in cents', optional: true },
  total_cost: { type: 'number', description: 'Total cost basis in cents', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete event position output definition
 */
export const KALSHI_EVENT_POSITION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi event position object',
  properties: KALSHI_EVENT_POSITION_OUTPUT_PROPERTIES,
}

/**
 * Output definition for fill/trade objects.
 * @see https://trading-api.readme.io/reference/getfills
 */
export const KALSHI_FILL_OUTPUT_PROPERTIES = {
  trade_id: { type: 'string', description: 'Unique trade identifier' },
  order_id: { type: 'string', description: 'Associated order ID' },
  ticker: { type: 'string', description: 'Market ticker' },
  side: { type: 'string', description: 'Trade side (yes/no)' },
  action: { type: 'string', description: 'Trade action (buy/sell)' },
  count: { type: 'number', description: 'Number of contracts' },
  yes_price: { type: 'number', description: 'Yes price in cents' },
  no_price: { type: 'number', description: 'No price in cents' },
  is_taker: { type: 'boolean', description: 'Whether this was a taker trade' },
  created_time: { type: 'string', description: 'Trade execution time (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete fill output definition
 */
export const KALSHI_FILL_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi trade fill object',
  properties: KALSHI_FILL_OUTPUT_PROPERTIES,
}

/**
 * Output definition for trade objects (public trades).
 * @see https://trading-api.readme.io/reference/gettrades
 */
export const KALSHI_TRADE_OUTPUT_PROPERTIES = {
  ticker: { type: 'string', description: 'Market ticker' },
  yes_price: { type: 'number', description: 'Trade price for yes in cents' },
  no_price: { type: 'number', description: 'Trade price for no in cents' },
  count: { type: 'number', description: 'Number of contracts traded' },
  taker_side: { type: 'string', description: 'Taker side (yes/no)' },
  created_time: { type: 'string', description: 'Trade time (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete trade output definition
 */
export const KALSHI_TRADE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi public trade object',
  properties: KALSHI_TRADE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for candlestick/OHLC objects.
 * @see https://trading-api.readme.io/reference/getmarketshistory
 */
export const KALSHI_CANDLESTICK_OUTPUT_PROPERTIES = {
  open_time: { type: 'string', description: 'Candle open time (ISO 8601)' },
  close_time: { type: 'string', description: 'Candle close time (ISO 8601)' },
  open: { type: 'number', description: 'Opening price in cents' },
  high: { type: 'number', description: 'High price in cents' },
  low: { type: 'number', description: 'Low price in cents' },
  close: { type: 'number', description: 'Closing price in cents' },
  volume: { type: 'number', description: 'Volume during period' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete candlestick output definition
 */
export const KALSHI_CANDLESTICK_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi price candlestick/OHLC data',
  properties: KALSHI_CANDLESTICK_OUTPUT_PROPERTIES,
}

/**
 * Output definition for orderbook level objects.
 * @see https://trading-api.readme.io/reference/getmarketorderbook
 */
export const KALSHI_ORDERBOOK_LEVEL_OUTPUT_PROPERTIES = {
  price: { type: 'number', description: 'Price level in cents' },
  quantity: { type: 'number', description: 'Quantity at this price level' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete orderbook level output definition
 */
export const KALSHI_ORDERBOOK_LEVEL_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Orderbook price level',
  properties: KALSHI_ORDERBOOK_LEVEL_OUTPUT_PROPERTIES,
}

/**
 * Output definition for series objects.
 * @see https://trading-api.readme.io/reference/getseries
 */
export const KALSHI_SERIES_OUTPUT_PROPERTIES = {
  ticker: { type: 'string', description: 'Unique series ticker' },
  title: { type: 'string', description: 'Series title' },
  frequency: { type: 'string', description: 'Event frequency (daily, weekly, etc.)' },
  category: { type: 'string', description: 'Series category' },
  tags: {
    type: 'array',
    description: 'Series tags',
    items: { type: 'string', description: 'Tag name' },
    optional: true,
  },
  contract_url: { type: 'string', description: 'Contract rules URL', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete series output definition
 */
export const KALSHI_SERIES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi series object',
  properties: KALSHI_SERIES_OUTPUT_PROPERTIES,
}

/**
 * Output definition for balance objects.
 * @see https://trading-api.readme.io/reference/getbalance
 */
export const KALSHI_BALANCE_OUTPUT_PROPERTIES = {
  balance: { type: 'number', description: 'Available balance in cents' },
  portfolio_value: { type: 'number', description: 'Total portfolio value in cents' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete balance output definition
 */
export const KALSHI_BALANCE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Kalshi account balance',
  properties: KALSHI_BALANCE_OUTPUT_PROPERTIES,
}

/**
 * Pagination output properties
 */
export const KALSHI_PAGING_OUTPUT_PROPERTIES = {
  cursor: { type: 'string', description: 'Cursor for fetching next page', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete paging output definition
 */
export const KALSHI_PAGING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information',
  properties: KALSHI_PAGING_OUTPUT_PROPERTIES,
}

// Base params for authenticated endpoints
export interface KalshiAuthParams {
  keyId: string // API Key ID
  privateKey: string // RSA Private Key (PEM format)
}

// Pagination params
export interface KalshiPaginationParams {
  limit?: string // 1-1000, default 100
  cursor?: string // Pagination cursor
}

// Pagination info in response
export interface KalshiPagingInfo {
  cursor?: string | null
}

// Generic response type
export interface KalshiResponse<T> {
  success: boolean
  output: T & {
    paging?: KalshiPagingInfo
    metadata: {
      operation: string
      [key: string]: any
    }
    success: boolean
  }
}

// Market type
export interface KalshiMarket {
  ticker: string
  event_ticker: string
  market_type: string
  title: string
  subtitle?: string
  yes_sub_title?: string
  no_sub_title?: string
  open_time: string
  close_time: string
  expiration_time: string
  status: string
  yes_bid: number
  yes_ask: number
  no_bid: number
  no_ask: number
  last_price: number
  previous_yes_bid?: number
  previous_yes_ask?: number
  previous_price?: number
  volume: number
  volume_24h: number
  liquidity?: number
  open_interest?: number
  result?: string
  cap_strike?: number
  floor_strike?: number
}

// Event type
export interface KalshiEvent {
  event_ticker: string
  series_ticker: string
  sub_title?: string
  title: string
  mutually_exclusive: boolean
  category: string
  markets?: KalshiMarket[]
  strike_date?: string
  status?: string
}

// Balance type
export interface KalshiBalance {
  balance: number // In cents
  portfolio_value: number // In cents
}

// Position type
export interface KalshiPosition {
  ticker: string
  event_ticker: string
  event_title?: string
  market_title?: string
  position: number
  market_exposure?: number
  realized_pnl?: number
  total_traded?: number
  resting_orders_count?: number
}

// Order type
export interface KalshiOrder {
  order_id: string
  ticker: string
  event_ticker: string
  status: string
  side: string
  type: string
  yes_price?: number
  no_price?: number
  action: string
  count: number
  remaining_count: number
  created_time: string
  expiration_time?: string
  place_count?: number
  decrease_count?: number
  maker_fill_count?: number
  taker_fill_count?: number
  taker_fees?: number
}

// Orderbook type
export interface KalshiOrderbookLevel {
  price: number
  quantity: number
}

export interface KalshiOrderbook {
  yes: KalshiOrderbookLevel[]
  no: KalshiOrderbookLevel[]
}

// Trade type
export interface KalshiTrade {
  ticker: string
  yes_price: number
  no_price: number
  count: number
  created_time: string
  taker_side: string
}

// Candlestick type
export interface KalshiCandlestick {
  open_time: string
  close_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Fill type
export interface KalshiFill {
  created_time: string
  ticker: string
  is_taker: boolean
  side: string
  yes_price: number
  no_price: number
  count: number
  order_id: string
  trade_id: string
}

// Settlement source type
export interface KalshiSettlementSource {
  name: string
  url: string
}

// Series type
export interface KalshiSeries {
  ticker: string
  title: string
  frequency: string
  category: string
  tags?: string[]
  settlement_sources?: KalshiSettlementSource[]
  contract_url?: string
  contract_terms_url?: string
  fee_type?: string // 'quadratic' | 'quadratic_with_maker_fees' | 'flat'
  fee_multiplier?: number
  additional_prohibitions?: string[]
  product_metadata?: Record<string, unknown>
}

// Exchange status type
export interface KalshiExchangeStatus {
  trading_active: boolean
  exchange_active: boolean
}

// Helper function to build Kalshi API URLs
export function buildKalshiUrl(path: string): string {
  return `${KALSHI_BASE_URL}${path}`
}

// Helper to normalize PEM key format
// Handles: literal \n strings, missing line breaks, various PEM formats
function normalizePemKey(privateKey: string): string {
  let key = privateKey.trim()

  // Convert literal \n strings to actual newlines
  key = key.replace(/\\n/g, '\n')

  // Extract the key type and base64 content
  const beginMatch = key.match(/-----BEGIN ([A-Z\s]+)-----/)
  const endMatch = key.match(/-----END ([A-Z\s]+)-----/)

  if (beginMatch && endMatch) {
    // Extract the key type (e.g., "RSA PRIVATE KEY" or "PRIVATE KEY")
    const keyType = beginMatch[1]

    // Extract base64 content between headers
    const startIdx = key.indexOf('-----', key.indexOf('-----') + 5) + 5
    const endIdx = key.lastIndexOf('-----END')
    let base64Content = key.substring(startIdx, endIdx)

    // Remove all whitespace from base64 content
    base64Content = base64Content.replace(/\s/g, '')

    // Reconstruct PEM with proper 64-character line breaks
    const lines: string[] = []
    for (let i = 0; i < base64Content.length; i += 64) {
      lines.push(base64Content.substring(i, i + 64))
    }

    return `-----BEGIN ${keyType}-----\n${lines.join('\n')}\n-----END ${keyType}-----`
  }

  // No PEM headers found - assume raw base64, wrap in PKCS#8 format
  const cleanKey = key.replace(/\s/g, '')
  const lines: string[] = []
  for (let i = 0; i < cleanKey.length; i += 64) {
    lines.push(cleanKey.substring(i, i + 64))
  }

  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
}

// RSA-PSS signature generation for authenticated requests
// Kalshi requires RSA-PSS with SHA256, not plain PKCS#1 v1.5
export function generateKalshiSignature(
  privateKey: string,
  timestamp: string,
  method: string,
  path: string
): string {
  // Sign: timestamp + method + path (without query params)
  // Strip query params from path for signing
  const pathWithoutQuery = path.split('?')[0]
  const message = timestamp + method.toUpperCase() + pathWithoutQuery

  // Normalize PEM key format (handles literal \n, missing line breaks, etc.)
  const pemKey = normalizePemKey(privateKey)

  // Use RSA-PSS padding with SHA256 (required by Kalshi API)
  const signature = crypto.sign('sha256', Buffer.from(message, 'utf-8'), {
    key: pemKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  })

  return signature.toString('base64')
}

// Build auth headers for authenticated requests
export function buildKalshiAuthHeaders(
  keyId: string,
  privateKey: string,
  method: string,
  path: string
): Record<string, string> {
  const timestamp = Date.now().toString()
  const signature = generateKalshiSignature(privateKey, timestamp, method, path)

  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'Content-Type': 'application/json',
  }
}

// Helper function for consistent error handling
export function handleKalshiError(data: any, status: number, operation: string): never {
  const errorMessage =
    data.error?.message || data.error || data.message || data.detail || 'Unknown error'
  throw new Error(`Kalshi ${operation} failed: ${errorMessage}`)
}
