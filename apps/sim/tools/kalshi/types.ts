import crypto from 'crypto'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Kalshi')

// Base URL for Kalshi API
export const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

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
  portfolio_value?: number // In cents
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

// Series type
export interface KalshiSeries {
  ticker: string
  title: string
  frequency: string
  category: string
  tags?: string[]
  status?: string
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

// RSA signature generation for authenticated requests
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

  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  return sign.sign(privateKey, 'base64')
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
  logger.error(`Kalshi API request failed for ${operation}`, { data, status })

  const errorMessage =
    data.error?.message || data.error || data.message || data.detail || 'Unknown error'
  throw new Error(`Kalshi ${operation} failed: ${errorMessage}`)
}
