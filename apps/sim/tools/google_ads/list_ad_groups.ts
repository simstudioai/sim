import type {
  GoogleAdsListAdGroupsParams,
  GoogleAdsListAdGroupsResponse,
} from '@/tools/google_ads/types'
import { validateNumericId, validateStatus } from '@/tools/google_ads/types'
import type { ToolConfig } from '@/tools/types'

export const googleAdsListAdGroupsTool: ToolConfig<
  GoogleAdsListAdGroupsParams,
  GoogleAdsListAdGroupsResponse
> = {
  id: 'google_ads_list_ad_groups',
  name: 'List Google Ads Ad Groups',
  description: 'List ad groups in a Google Ads campaign',
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
    campaignId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Campaign ID to list ad groups for',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by ad group status (ENABLED, PAUSED, REMOVED)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of ad groups to return',
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
        'SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, campaign.id, campaign.name FROM ad_group'

      const campaignId = validateNumericId(params.campaignId, 'campaignId')
      const conditions: string[] = [`campaign.id = ${campaignId}`]

      if (params.status) {
        conditions.push(`ad_group.status = '${validateStatus(params.status)}'`)
      } else {
        conditions.push("ad_group.status != 'REMOVED'")
      }

      query += ` WHERE ${conditions.join(' AND ')}`
      query += ' ORDER BY ad_group.name'

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
        output: { adGroups: [], totalCount: 0 },
        error: errorMessage,
      }
    }

    const results = data.results ?? []
    const adGroups = results.map((r: Record<string, any>) => ({
      id: r.adGroup?.id ?? '',
      name: r.adGroup?.name ?? '',
      status: r.adGroup?.status ?? '',
      type: r.adGroup?.type ?? null,
      campaignId: r.campaign?.id ?? '',
      campaignName: r.campaign?.name ?? null,
    }))

    return {
      success: true,
      output: {
        adGroups,
        totalCount: adGroups.length,
      },
    }
  },

  outputs: {
    adGroups: {
      type: 'array',
      description: 'List of ad groups in the campaign',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Ad group ID' },
          name: { type: 'string', description: 'Ad group name' },
          status: { type: 'string', description: 'Ad group status (ENABLED, PAUSED, REMOVED)' },
          type: {
            type: 'string',
            description: 'Ad group type (SEARCH_STANDARD, DISPLAY_STANDARD, SHOPPING_PRODUCT_ADS)',
          },
          campaignId: { type: 'string', description: 'Parent campaign ID' },
          campaignName: { type: 'string', description: 'Parent campaign name' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of ad groups returned',
    },
  },
}
