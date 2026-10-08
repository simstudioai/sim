import type {
  GoogleAdsAdPerformanceParams,
  GoogleAdsAdPerformanceResponse,
  GoogleAdsApiResponse,
} from '@/tools/google_ads/types'
import { buildDateCondition, validateLimit, validateNumericId } from '@/tools/google_ads/types'
import type { ToolConfig } from '@/tools/types'

export const googleAdsAdPerformanceTool: ToolConfig<
  GoogleAdsAdPerformanceParams,
  GoogleAdsAdPerformanceResponse
> = {
  id: 'google_ads_ad_performance',
  name: 'Google Ads Ad Performance',
  description: 'Get performance metrics for individual ads over a date range',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-ads',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Google Ads API',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Continuation token from the previous page; keep the same customer and query inputs',
    },
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Ads customer ID (numeric, no dashes)',
    },
    managerCustomerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Manager account customer ID (if accessing via manager account)',
    },
    campaignId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by campaign ID',
    },
    adGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by ad group ID',
    },
    dateRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Predefined date range (LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH, TODAY, YESTERDAY)',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom start date in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom end date in YYYY-MM-DD format',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return',
    },
  },

  request: {
    url: (params) => {
      const customerId = validateNumericId(params.customerId, 'customerId')
      return `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`
    },
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
      if (params.managerCustomerId) {
        headers['login-customer-id'] = validateNumericId(
          params.managerCustomerId,
          'managerCustomerId'
        )
      }
      return headers
    },
    body: (params) => {
      let query =
        'SELECT ad_group_ad.ad.id, ad_group.id, ad_group.name, campaign.id, campaign.name, ad_group_ad.ad.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions, segments.date FROM ad_group_ad'

      const conditions: string[] = ["ad_group_ad.status != 'REMOVED'"]

      if (params.campaignId) {
        conditions.push(`campaign.id = ${validateNumericId(params.campaignId, 'campaignId')}`)
      }

      if (params.adGroupId) {
        conditions.push(`ad_group.id = ${validateNumericId(params.adGroupId, 'adGroupId')}`)
      }

      conditions.push(buildDateCondition(params))

      query += ` WHERE ${conditions.join(' AND ')}`
      query += ' ORDER BY metrics.impressions DESC'

      if (params.limit !== undefined) {
        query += ` LIMIT ${validateLimit(params.limit)}`
      }

      return { query, ...(params.pageToken ? { pageToken: params.pageToken } : {}) }
    },
  },

  transformResponse: async (response: Response) => {
    const data: GoogleAdsApiResponse = await response.json()

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ?? data?.error?.details?.[0]?.errors?.[0]?.message ?? 'Unknown error'
      return {
        success: false,
        output: { ads: [], totalCount: 0, nextPageToken: null },
        error: errorMessage,
      }
    }

    const results = data.results ?? []
    const ads = results.map((r) => ({
      adId: r.adGroupAd?.ad?.id ?? '',
      adGroupId: r.adGroup?.id ?? '',
      adGroupName: r.adGroup?.name ?? null,
      campaignId: r.campaign?.id ?? '',
      campaignName: r.campaign?.name ?? null,
      adType: r.adGroupAd?.ad?.type ?? null,
      impressions: r.metrics?.impressions ?? '0',
      clicks: r.metrics?.clicks ?? '0',
      costMicros: r.metrics?.costMicros ?? '0',
      ctr: r.metrics?.ctr ?? null,
      conversions: r.metrics?.conversions ?? null,
      date: r.segments?.date ?? null,
    }))

    return {
      success: true,
      output: {
        ads,
        totalCount: ads.length,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    nextPageToken: {
      type: 'string',
      optional: true,
      nullable: true,
      description: 'Continuation token, or null on the last page; reuse unchanged query inputs',
    },
    ads: {
      type: 'array',
      description: 'Ad performance data broken down by date',
      items: {
        type: 'object',
        properties: {
          adId: { type: 'string', description: 'Ad ID' },
          adGroupId: { type: 'string', description: 'Parent ad group ID' },
          adGroupName: {
            type: 'string',
            optional: true,
            nullable: true,
            description: 'Parent ad group name',
          },
          campaignId: { type: 'string', description: 'Parent campaign ID' },
          campaignName: {
            type: 'string',
            optional: true,
            nullable: true,
            description: 'Parent campaign name',
          },
          adType: {
            type: 'string',
            optional: true,
            nullable: true,
            description: 'Ad type (RESPONSIVE_SEARCH_AD, EXPANDED_TEXT_AD, etc.)',
          },
          impressions: { type: 'string', description: 'Number of impressions' },
          clicks: { type: 'string', description: 'Number of clicks' },
          costMicros: {
            type: 'string',
            description: 'Cost in micros (divide by 1,000,000 for currency value)',
          },
          ctr: {
            type: 'number',
            optional: true,
            nullable: true,
            description: 'Click-through rate (0.0 to 1.0)',
          },
          conversions: {
            type: 'number',
            optional: true,
            nullable: true,
            description: 'Number of conversions',
          },
          date: {
            type: 'string',
            optional: true,
            nullable: true,
            description: 'Date for this row (YYYY-MM-DD)',
          },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of rows in this page',
    },
  },
}
