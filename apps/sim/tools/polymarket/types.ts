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
  createdAt?: string
  updatedAt?: string
  forceShow?: boolean
  forceHide?: boolean
  isCarousel?: boolean
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
  min_order_size: string
  tick_size: string
  neg_risk: boolean
}

export interface PolymarketPrice {
  price: string
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
  tags: PolymarketTag[]
  profiles: PolymarketProfile[]
}

export interface PolymarketProfile {
  id: string
  name: string | null
  pseudonym: string | null
  bio: string | null
  profileImage: string | null
  profileImageOptimized: string | null
  walletAddress: string
}

export interface PolymarketSpread {
  spread: string
}

export interface PolymarketPosition {
  proxyWallet: string | null
  asset: string
  conditionId: string
  size: number
  avgPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  totalBought: number
  realizedPnl: number
  percentRealizedPnl: number
  curPrice: number
  redeemable: boolean
  mergeable: boolean
  title: string | null
  slug: string | null
  icon: string | null
  eventSlug: string | null
  outcome: string | null
  outcomeIndex: number | null
  oppositeOutcome: string | null
  oppositeAsset: string | null
  endDate: string | null
  negativeRisk: boolean
}

export interface PolymarketTrade {
  proxyWallet: string | null
  side: string
  asset: string
  conditionId: string
  size: number
  price: number
  timestamp: number
  title: string | null
  slug: string | null
  icon: string | null
  eventSlug: string | null
  outcome: string | null
  outcomeIndex: number | null
  name: string | null
  pseudonym: string | null
  bio: string | null
  profileImage: string | null
  profileImageOptimized: string | null
  transactionHash: string | null
}

export interface PolymarketActivity {
  proxyWallet: string | null
  timestamp: number
  conditionId: string
  type: string
  size: number
  usdcSize: number
  transactionHash: string | null
  price: number | null
  asset: string | null
  side: string | null
  outcomeIndex: number | null
  title: string | null
  slug: string | null
  icon: string | null
  eventSlug: string | null
  outcome: string | null
  name: string | null
  pseudonym: string | null
  bio: string | null
  profileImage: string | null
  profileImageOptimized: string | null
}

export interface PolymarketLeaderboardEntry {
  rank: string
  proxyWallet: string
  userName: string | null
  vol: number
  pnl: number
  profileImage: string | null
  xUsername: string | null
  verifiedBadge: boolean
}

export interface PolymarketHolder {
  proxyWallet: string
  bio: string | null
  asset: string
  pseudonym: string | null
  amount: number
  displayUsernamePublic: boolean
  outcomeIndex: number
  name: string | null
  profileImage: string | null
  profileImageOptimized: string | null
}

export interface PolymarketMarketHolders {
  token: string
  holders: PolymarketHolder[]
}

export function handlePolymarketError(data: any, status: number, operation: string): never {
  const errorMessage = data?.message || data?.error || `Unknown error during ${operation}`
  throw new Error(`Polymarket API error (${status}): ${errorMessage}`)
}
