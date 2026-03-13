import type {
  GoogleAdsListCampaignsParams,
  GoogleAdsListCampaignsResponse,
} from '@/tools/google_ads/types'
import { validateNumericId, validateStatus } from '@/tools/google_ads/types'
import type { ToolConfig } from '@/tools/types'

export const googleAdsListCampaignsTool: ToolConfig<
  GoogleAdsListCampaignsParams,
  GoogleAdsListCampaignsResponse
> = {
  id: 'google_ads_list_campaigns',
  name: 'List Google Ads Campaigns',
  description: 'List campaigns in a Google Ads account with optional status filtering',
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
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Ads customer ID (numeric, no dashes)',
    },
    developerToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Ads API developer token',
    },
    managerCustomerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Manager account customer ID (if accessing via manager account)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by campaign status (ENABLED, PAUSED, REMOVED)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of campaigns to return',
    },
  },

  request: {
    url: (params) => {
      const customerId = validateNumericId(params.customerId, 'customerId')
      return `https://googleads.googleapis.com/v19/customers/${customerId}/googleAds:search`
    },
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        'developer-token': params.developerToken,
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
        'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, campaign_budget.amount_micros FROM campaign'

      const conditions: string[] = []
      if (params.status) {
        conditions.push(`campaign.status = '${validateStatus(params.status)}'`)
      } else {
        conditions.push("campaign.status != 'REMOVED'")
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`
      }

      query += ' ORDER BY campaign.name'

      if (params.limit) {
        query += ` LIMIT ${params.limit}`
      }

      return { query }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ?? data?.error?.details?.[0]?.errors?.[0]?.message ?? 'Unknown error'
      return {
        success: false,
        output: { campaigns: [], totalCount: 0 },
        error: errorMessage,
      }
    }

    const results = data.results ?? []
    const campaigns = results.map((r: Record<string, any>) => ({
      id: r.campaign?.id ?? '',
      name: r.campaign?.name ?? '',
      status: r.campaign?.status ?? '',
      channelType: r.campaign?.advertisingChannelType ?? null,
      startDate: r.campaign?.startDate ?? null,
      endDate: r.campaign?.endDate ?? null,
      budgetAmountMicros: r.campaignBudget?.amountMicros ?? null,
    }))

    return {
      success: true,
      output: {
        campaigns,
        totalCount: campaigns.length,
      },
    }
  },

  outputs: {
    campaigns: {
      type: 'array',
      description: 'List of campaigns in the account',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Campaign ID' },
          name: { type: 'string', description: 'Campaign name' },
          status: { type: 'string', description: 'Campaign status (ENABLED, PAUSED, REMOVED)' },
          channelType: {
            type: 'string',
            description:
              'Advertising channel type (SEARCH, DISPLAY, SHOPPING, VIDEO, PERFORMANCE_MAX)',
          },
          startDate: { type: 'string', description: 'Campaign start date (YYYY-MM-DD)' },
          endDate: { type: 'string', description: 'Campaign end date (YYYY-MM-DD)' },
          budgetAmountMicros: {
            type: 'string',
            description: 'Daily budget in micros (divide by 1,000,000 for currency value)',
          },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of campaigns returned',
    },
  },
}
