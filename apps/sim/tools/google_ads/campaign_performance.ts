import type {
  GoogleAdsApiResponse,
  GoogleAdsCampaignPerformanceParams,
  GoogleAdsCampaignPerformanceResponse,
} from '@/tools/google_ads/types'
import { buildDateCondition, validateNumericId } from '@/tools/google_ads/types'
import type { ToolConfig } from '@/tools/types'

export const googleAdsCampaignPerformanceTool: ToolConfig<
  GoogleAdsCampaignPerformanceParams,
  GoogleAdsCampaignPerformanceResponse
> = {
  id: 'google_ads_campaign_performance',
  name: 'Google Ads Campaign Performance',
  description: 'Get performance metrics for Google Ads campaigns over a date range',
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
      description: 'Filter by specific campaign ID',
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
        'SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions, segments.date FROM campaign'

      const conditions: string[] = ["campaign.status != 'REMOVED'"]

      if (params.campaignId) {
        conditions.push(`campaign.id = ${validateNumericId(params.campaignId, 'campaignId')}`)
      }

      conditions.push(buildDateCondition(params))

      query += ` WHERE ${conditions.join(' AND ')}`
      query += ' ORDER BY metrics.impressions DESC'

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
        output: { campaigns: [], totalCount: 0, nextPageToken: null },
        error: errorMessage,
      }
    }

    const results = data.results ?? []
    const campaigns = results.map((r) => ({
      id: r.campaign?.id ?? '',
      name: r.campaign?.name ?? '',
      status: r.campaign?.status ?? '',
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
        campaigns,
        totalCount: campaigns.length,
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
    campaigns: {
      type: 'array',
      description: 'Campaign performance data broken down by date',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Campaign ID' },
          name: { type: 'string', description: 'Campaign name' },
          status: { type: 'string', description: 'Campaign status' },
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
