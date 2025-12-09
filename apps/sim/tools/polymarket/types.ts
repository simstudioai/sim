export const POLYMARKET_GAMMA_URL = 'https://gamma-api.polymarket.com'
export const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com'
export const POLYMARKET_DATA_URL = 'https://data-api.polymarket.com'

export function buildGammaUrl(path: string): string {
  return `${POLYMARKET_GAMMA_URL}${path}`
}

export function buildClobUrl(path: string): string {
  return `${POLYMARKET_CLOB_URL}${path}`
}

export function buildDataUrl(path: string): string {
  return `${POLYMARKET_DATA_URL}${path}`
}

export interface PolymarketPaginationParams {
  limit?: string
  offset?: string
}

export interface PolymarketPagingInfo {
  limit: number
  offset: number
  count: number
}

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

export interface PolymarketTag {
  id: string
  label: string
  slug: string
}

export interface PolymarketOrderBookEntry {
  price: string
  size: string
}

export interface PolymarketOrderBook {
  market: string
  asset_id: string
  hash: string
  timestamp: string
  bids: PolymarketOrderBookEntry[]
  asks: PolymarketOrderBookEntry[]
}

export interface PolymarketPrice {
  price: string
  side: string
}

export interface PolymarketPriceHistoryEntry {
  t: number
  p: number
}

export interface PolymarketSeries {
  id: string
  ticker: string
  slug: string
  title: string
  seriesType: string
  recurrence: string
  image: string
  icon: string
  active: boolean
  closed: boolean
  archived: boolean
  featured: boolean
  restricted: boolean
  createdAt: string
  updatedAt: string
  volume: number
  liquidity: number
  commentCount: number
  eventCount: number
}

export interface PolymarketSearchResult {
  markets: PolymarketMarket[]
  events: PolymarketEvent[]
  profiles: any[]
}

export interface PolymarketSpread {
  bid: string
  ask: string
}

export interface PolymarketPosition {
  market: string
  asset_id: string
  size: string
  value: string
}

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

export function handlePolymarketError(data: any, status: number, operation: string): never {
  const errorMessage = data?.message || data?.error || `Unknown error during ${operation}`
  throw new Error(`Polymarket API error (${status}): ${errorMessage}`)
}
