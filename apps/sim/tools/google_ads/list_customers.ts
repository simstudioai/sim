import type {
  GoogleAdsListCustomersParams,
  GoogleAdsListCustomersResponse,
} from '@/tools/google_ads/types'
import type { ToolConfig } from '@/tools/types'

export const googleAdsListCustomersTool: ToolConfig<
  GoogleAdsListCustomersParams,
  GoogleAdsListCustomersResponse
> = {
  id: 'google_ads_list_customers',
  name: 'List Google Ads Customers',
  description: 'List all Google Ads customer accounts accessible by the authenticated user',
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
    developerToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Ads API developer token',
    },
  },

  request: {
    url: 'https://googleads.googleapis.com/v19/customers:listAccessibleCustomers',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'developer-token': params.developerToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ?? data?.error?.details?.[0]?.errors?.[0]?.message ?? 'Unknown error'
      return {
        success: false,
        output: { customerIds: [], totalCount: 0 },
        error: errorMessage,
      }
    }

    const resourceNames: string[] = data.resourceNames ?? []
    const customerIds = resourceNames.map((rn: string) => rn.replace('customers/', ''))

    return {
      success: true,
      output: {
        customerIds,
        totalCount: customerIds.length,
      },
    }
  },

  outputs: {
    customerIds: {
      type: 'array',
      description: 'List of accessible customer IDs',
      items: {
        type: 'string',
        description: 'Google Ads customer ID (numeric, no dashes)',
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of accessible customer accounts',
    },
  },
}
