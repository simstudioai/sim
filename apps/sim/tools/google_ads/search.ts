import type { GoogleAdsSearchParams, GoogleAdsSearchResponse } from '@/tools/google_ads/types'
import { validateNumericId } from '@/tools/google_ads/types'
import type { ToolConfig } from '@/tools/types'

export const googleAdsSearchTool: ToolConfig<GoogleAdsSearchParams, GoogleAdsSearchResponse> = {
  id: 'google_ads_search',
  name: 'Google Ads Search (GAQL)',
  description: 'Run a custom Google Ads Query Language (GAQL) query',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GAQL query to execute',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token for pagination',
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
      const body: Record<string, unknown> = {
        query: params.query,
        searchSettings: {
          returnTotalResultsCount: true,
        },
      }
      if (params.pageToken) {
        body.pageToken = params.pageToken
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ?? data?.error?.details?.[0]?.errors?.[0]?.message ?? 'Unknown error'
      return {
        success: false,
        output: {
          results: [],
          totalResultsCount: null,
          nextPageToken: null,
        },
        error: errorMessage,
      }
    }

    return {
      success: true,
      output: {
        results: data.results ?? [],
        totalResultsCount: data.totalResultsCount ? Number(data.totalResultsCount) : null,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    results: {
      type: 'json',
      description: 'Array of result objects from the GAQL query',
    },
    totalResultsCount: {
      type: 'number',
      description: 'Total number of matching results',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results',
    },
  },
}
