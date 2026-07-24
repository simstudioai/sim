import type { ToolResponse } from '@/tools/types'

export type AdanosStockSource = 'reddit' | 'x' | 'news' | 'polymarket'
export type AdanosAssetType = 'stocks' | 'crypto'

export interface AdanosDateRangeParams {
  apiKey: string
  startDate?: string
  endDate?: string
}

export interface AdanosStockSentimentParams extends AdanosDateRangeParams {
  ticker: string
  source: AdanosStockSource
}

export interface AdanosCryptoSentimentParams extends AdanosDateRangeParams {
  symbol: string
}

export interface AdanosTrendingParams extends AdanosDateRangeParams {
  assetType: AdanosAssetType
  source?: AdanosStockSource
  limit?: number
}

export interface AdanosMarketSentimentParams extends AdanosDateRangeParams {
  assetType: AdanosAssetType
  source?: AdanosStockSource
}

export interface AdanosDailyTrend {
  date: string
  activityCount: number
  sentimentScore: number | null
  buzzScore: number | null
  bullishPct: number | null
  bearishPct: number | null
}

export interface AdanosAssetSentiment {
  assetType: AdanosAssetType
  source: AdanosStockSource
  symbol: string
  name: string | null
  found: boolean
  buzzScore: number | null
  sentimentScore: number | null
  trend: string | null
  bullishPct: number | null
  bearishPct: number | null
  activityCount: number
  periodDays: number | null
  dailyTrend: AdanosDailyTrend[]
}

export interface AdanosTrendingAsset {
  assetType: AdanosAssetType
  source: AdanosStockSource
  symbol: string
  name: string | null
  buzzScore: number | null
  sentimentScore: number | null
  trend: string | null
  bullishPct: number | null
  bearishPct: number | null
  activityCount: number
}

export interface AdanosMarketDriver {
  symbol: string
  activityCount: number
  buzzScore: number | null
  sentimentScore: number | null
}

export interface AdanosMarketOverview {
  assetType: AdanosAssetType
  source: AdanosStockSource
  buzzScore: number | null
  sentimentScore: number | null
  trend: string | null
  bullishPct: number | null
  bearishPct: number | null
  activityCount: number
  activeAssets: number
  drivers: AdanosMarketDriver[]
}

export interface AdanosStockSentimentResponse extends ToolResponse {
  output: AdanosAssetSentiment
}

export interface AdanosCryptoSentimentResponse extends ToolResponse {
  output: AdanosAssetSentiment
}

export interface AdanosTrendingResponse extends ToolResponse {
  output: {
    assets: AdanosTrendingAsset[]
  }
}

export interface AdanosMarketSentimentResponse extends ToolResponse {
  output: AdanosMarketOverview
}

export interface AdanosRawDailyTrend {
  date?: string
  mentions?: number
  trade_count?: number
  sentiment_score?: number | null
  buzz_score?: number | null
  bullish_pct?: number | null
  bearish_pct?: number | null
}

export interface AdanosRawAsset {
  ticker?: string
  symbol?: string
  company_name?: string | null
  name?: string | null
  found?: boolean
  buzz_score?: number | null
  sentiment_score?: number | null
  trend?: string | null
  bullish_pct?: number | null
  bearish_pct?: number | null
  mentions?: number
  trade_count?: number
  period_days?: number | null
  daily_trend?: AdanosRawDailyTrend[]
}

export interface AdanosRawMarketDriver {
  ticker?: string
  symbol?: string
  mentions?: number
  trade_count?: number
  buzz_score?: number | null
  sentiment_score?: number | null
}

export interface AdanosRawMarketOverview {
  buzz_score?: number | null
  sentiment_score?: number | null
  trend?: string | null
  bullish_pct?: number | null
  bearish_pct?: number | null
  mentions?: number
  trade_count?: number
  active_tickers?: number
  drivers?: AdanosRawMarketDriver[]
}
