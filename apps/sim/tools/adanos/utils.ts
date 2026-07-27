import type {
  AdanosAssetType,
  AdanosDateRangeParams,
  AdanosRawAsset,
  AdanosRawDailyTrend,
  AdanosRawMarketDriver,
  AdanosStockSource,
} from '@/tools/adanos/types'

const ADANOS_BASE_URL = 'https://api.adanos.org'

const STOCK_SOURCE_PATHS: Record<AdanosStockSource, string> = {
  reddit: '/reddit/stocks/v1',
  x: '/x/stocks/v1',
  news: '/news/stocks/v1',
  polymarket: '/polymarket/stocks/v1',
}

function isCryptoAssetType(assetType: AdanosAssetType) {
  return assetType.trim().toLowerCase() === 'crypto'
}

export function getAdanosSource(assetType: AdanosAssetType, source?: AdanosStockSource) {
  return isCryptoAssetType(assetType) ? 'reddit' : (source ?? 'reddit')
}

export function getAdanosBasePath(assetType: AdanosAssetType, source?: AdanosStockSource) {
  if (isCryptoAssetType(assetType)) {
    return '/reddit/crypto/v1'
  }

  const sourcePath = STOCK_SOURCE_PATHS[source ?? 'reddit']
  if (!sourcePath) {
    throw new Error('Stock source must be reddit, x, news, or polymarket')
  }

  return sourcePath
}

export function buildAdanosUrl(path: string, params: AdanosDateRangeParams, limit?: number) {
  const url = new URL(path, ADANOS_BASE_URL)

  if (params.startDate?.trim()) {
    url.searchParams.set('from', params.startDate.trim())
  }
  if (params.endDate?.trim()) {
    url.searchParams.set('to', params.endDate.trim())
  }
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Result limit must be an integer from 1 to 100')
    }
    url.searchParams.set('limit', String(limit))
  }

  return url.toString()
}

export function getAdanosHeaders(apiKey: string) {
  return {
    Accept: 'application/json',
    'X-API-Key': apiKey.trim(),
  }
}

export function getActivityCount(data: { mentions?: number; trade_count?: number }) {
  return data.mentions ?? data.trade_count ?? 0
}

export function normalizeDailyTrend(items: AdanosRawDailyTrend[] | undefined) {
  return (items ?? []).map((item) => ({
    date: item.date ?? '',
    activityCount: getActivityCount(item),
    sentimentScore: item.sentiment_score ?? null,
    buzzScore: item.buzz_score ?? null,
    bullishPct: item.bullish_pct ?? null,
    bearishPct: item.bearish_pct ?? null,
  }))
}

export function normalizeAsset(
  data: AdanosRawAsset,
  assetType: AdanosAssetType,
  source: AdanosStockSource
) {
  return {
    assetType,
    source,
    symbol: data.ticker ?? data.symbol ?? '',
    name: data.company_name ?? data.name ?? null,
    found: data.found ?? false,
    buzzScore: data.buzz_score ?? null,
    sentimentScore: data.sentiment_score ?? null,
    trend: data.trend ?? null,
    bullishPct: data.bullish_pct ?? null,
    bearishPct: data.bearish_pct ?? null,
    activityCount: getActivityCount(data),
    periodDays: data.period_days ?? null,
    dailyTrend: normalizeDailyTrend(data.daily_trend),
  }
}

export function normalizeDriver(data: AdanosRawMarketDriver) {
  return {
    symbol: data.ticker ?? data.symbol ?? '',
    activityCount: getActivityCount(data),
    buzzScore: data.buzz_score ?? null,
    sentimentScore: data.sentiment_score ?? null,
  }
}

export async function readAdanosResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & {
    detail?: string | { message?: string }
    message?: string
  }

  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : data.detail?.message
    throw new Error(detail ?? data.message ?? `Adanos API request failed (${response.status})`)
  }

  return data
}
