// Polymarket API Types and Helpers

// Base URLs for different Polymarket APIs
export const POLYMARKET_GAMMA_URL = 'https://gamma-api.polymarket.com'
export const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com'
export const POLYMARKET_DATA_URL = 'https://data-api.polymarket.com'

// Helper to build Gamma API URL
export function buildGammaUrl(path: string): string {
  return `${POLYMARKET_GAMMA_URL}${path}`
}

// Helper to build CLOB API URL
export function buildClobUrl(path: string): string {
  return `${POLYMARKET_CLOB_URL}${path}`
}

// Helper to build Data API URL
export function buildDataUrl(path: string): string {
  return `${POLYMARKET_DATA_URL}${path}`
}

// Common pagination parameters
export interface PolymarketPaginationParams {
  limit?: string
  offset?: string
}

// Paging info in responses
export interface PolymarketPagingInfo {
  limit: number
  offset: number
  count: number
}

// Market structure
export interface PolymarketMarket {
  id: string
  question: string
  conditionId: string
  slug: string
  resolutionSource: string
  endDate: string
  liquidity: string
  startDate: string
  image: string
  icon: string
  description: string
  outcomes: string
  outcomePrices: string
  volume: string
  active: boolean
  closed: boolean
  marketMakerAddress: string
  createdAt: string
  updatedAt: string
  new: boolean
  featured: boolean
  submitted_by: string
  archived: boolean
  resolvedBy: string
  restricted: boolean
  groupItemTitle: string
  groupItemThreshold: string
  questionID: string
  enableOrderBook: boolean
  orderPriceMinTickSize: number
  orderMinSize: number
  volumeNum: number
  liquidityNum: number
  clobTokenIds: string[]
  acceptingOrders: boolean
  negRisk: boolean
}

// Event structure
export interface PolymarketEvent {
  id: string
  ticker: string
  slug: string
  title: string
  description: string
  startDate: string
  creationDate: string
  endDate: string
  image: string
  icon: string
  active: boolean
  closed: boolean
  archived: boolean
  new: boolean
  featured: boolean
  restricted: boolean
  liquidity: number
  volume: number
  openInterest: number
  commentCount: number
  markets: PolymarketMarket[]
}

// Tag structure
export interface PolymarketTag {
  id: string
  label: string
  slug: string
}

// Order book entry
export interface PolymarketOrderBookEntry {
  price: string
  size: string
}

// Order book structure
export interface PolymarketOrderBook {
  market: string
  asset_id: string
  hash: string
  timestamp: string
  bids: PolymarketOrderBookEntry[]
  asks: PolymarketOrderBookEntry[]
}

// Price structure
export interface PolymarketPrice {
  price: string
  side: string
}

// Price history entry
export interface PolymarketPriceHistoryEntry {
  t: number // timestamp
  p: number // price
}

// Series structure
export interface PolymarketSeries {
  id: string
  title: string
  slug: string
  description: string
  image: string
  markets: PolymarketMarket[]
}

// Search result structure
export interface PolymarketSearchResult {
  markets: PolymarketMarket[]
  events: PolymarketEvent[]
  profiles: any[] // Profile structure not fully documented
}

// Spread structure
export interface PolymarketSpread {
  bid: string
  ask: string
}

// Position structure
export interface PolymarketPosition {
  market: string
  asset_id: string
  size: string
  value: string
}

// Trade structure
export interface PolymarketTrade {
  id: string
  market: string
  asset_id: string
  side: string
  size: string
  price: string
  timestamp: string
  maker: string
  taker: string
}

// Error handler for Polymarket API responses
export function handlePolymarketError(data: any, status: number, operation: string): never {
  const errorMessage = data?.message || data?.error || `Unknown error during ${operation}`
  throw new Error(`Polymarket API error (${status}): ${errorMessage}`)
}
