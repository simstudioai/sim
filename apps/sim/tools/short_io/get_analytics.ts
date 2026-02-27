import type { ShortIoGetAnalyticsParams } from '@/tools/short_io/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const STATS_PERIOD_MAP: Record<string, string> = {
  today: 'today',
  yesterday: 'yesterday',
  last_7_days: 'last7',
  last_30_days: 'last30',
  all_time: 'total',
  week: 'week',
  month: 'month',
  lastmonth: 'lastmonth',
}

export const shortIoGetAnalyticsTool: ToolConfig<ShortIoGetAnalyticsParams, ToolResponse> = {
  id: 'short_io_get_analytics',
  name: 'Short.io Get Link Statistics',
  description:
    'Fetch click statistics for a Short.io link (Statistics API: totalClicks, humanClicks, referer, country, etc.).',
  version: '1.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Short.io Secret API Key',
    },
    linkId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Link ID' },
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Period: today, yesterday, last7, last30, total, week, month, lastmonth',
    },
    tz: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Timezone (default UTC)',
    },
  },
  request: {
    url: (params) => {
      const base = `https://statistics.short.io/statistics/link/${encodeURIComponent(params.linkId)}`
      const period = STATS_PERIOD_MAP[params.period] ?? params.period ?? 'last30'
      const q = new URLSearchParams({ period })
      if (params.tz) q.set('tz', params.tz)
      return `${base}?${q.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey,
      Accept: 'application/json',
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const err = await response.text().catch(() => response.statusText)
      return { success: false, output: { success: false, error: err } }
    }
    const data = await response.json().catch(() => ({}))
    const totalClicks = data.totalClicks ?? data.clicks ?? 0
    const humanClicks = data.humanClicks ?? totalClicks
    return {
      success: true,
      output: {
        success: true,
        clicks: totalClicks,
        totalClicks,
        humanClicks,
        totalClicksChange: data.totalClicksChange,
        humanClicksChange: data.humanClicksChange,
        referer: data.referer ?? [],
        country: data.country ?? [],
        browser: data.browser ?? [],
        os: data.os ?? [],
        city: data.city ?? [],
        device: data.device ?? [],
        social: data.social ?? [],
        utmMedium: data.utm_medium ?? [],
        utmSource: data.utm_source ?? [],
        utmCampaign: data.utm_campaign ?? [],
        clickStatistics: data.clickStatistics,
        interval: data.interval,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    clicks: { type: 'number', description: 'Total clicks in period' },
    totalClicks: { type: 'number', description: 'Total clicks' },
    humanClicks: { type: 'number', description: 'Human clicks' },
    totalClicksChange: { type: 'string', description: 'Change vs previous period' },
    humanClicksChange: { type: 'string', description: 'Human clicks change' },
    referer: { type: 'array', description: 'Referrer breakdown (referer, score)' },
    country: { type: 'array', description: 'Country breakdown (countryName, country, score)' },
    browser: { type: 'array', description: 'Browser breakdown (browser, score)' },
    os: { type: 'array', description: 'OS breakdown (os, score)' },
    city: { type: 'array', description: 'City breakdown (city, name, countryCode, score)' },
    device: { type: 'array', description: 'Device breakdown' },
    social: { type: 'array', description: 'Social source breakdown (social, score)' },
    utmMedium: { type: 'array', description: 'UTM medium breakdown' },
    utmSource: { type: 'array', description: 'UTM source breakdown' },
    utmCampaign: { type: 'array', description: 'UTM campaign breakdown' },
    clickStatistics: {
      type: 'object',
      description: 'Time-series click data (datasets with x/y points per interval)',
    },
    interval: {
      type: 'object',
      description: 'Date range (startDate, endDate, prevStartDate, prevEndDate, tz)',
    },
    error: { type: 'string', description: 'Error message' },
  },
}
