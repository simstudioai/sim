import type {
  GoogleAdsApiResponse,
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
  description:
    'List Google Ads accounts directly accessible by the authenticated user; query customer_client for manager subaccounts',
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
  },

  request: {
    url: 'https://googleads.googleapis.com/v24/customers:listAccessibleCustomers',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data: GoogleAdsApiResponse = await response.json()

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
      description: 'Customer IDs directly accessible by the user',
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
