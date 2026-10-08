import type {
  GoogleAdsApiResponse,
  GoogleAdsListAdGroupsParams,
  GoogleAdsListAdGroupsResponse,
} from '@/tools/google_ads/types'
import { validateLimit, validateNumericId, validateStatus } from '@/tools/google_ads/types'
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

      if (params.limit != null) {
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
        output: { adGroups: [], totalCount: 0, nextPageToken: null },
        error: errorMessage,
      }
    }

    const results = data.results ?? []
    const adGroups = results.map((r) => ({
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
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    nextPageToken: {
      type: 'string',
      nullable: true,
      description: 'Continuation token, or null on the last page; reuse unchanged query inputs',
    },
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
            nullable: true,
            description: 'Ad group type (SEARCH_STANDARD, DISPLAY_STANDARD, SHOPPING_PRODUCT_ADS)',
          },
          campaignId: { type: 'string', description: 'Parent campaign ID' },
          campaignName: {
            type: 'string',
            nullable: true,
            description: 'Parent campaign name',
          },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of ad groups in this page',
    },
  },
}
