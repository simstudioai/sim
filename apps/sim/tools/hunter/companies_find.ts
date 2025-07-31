import type { HunterEnrichmentParams, HunterEnrichmentResponse } from '@/tools/hunter/types'
import type { ToolConfig } from '@/tools/types'

export const companiesFindTool: ToolConfig<HunterEnrichmentParams, HunterEnrichmentResponse> = {
  id: 'hunter_companies_find',
  name: 'Hunter Companies Find',
  description: 'Enriches company data using domain name.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain to find company data for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hunter.io API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.hunter.io/v2/companies/find')
      url.searchParams.append('api_key', params.apiKey)
      url.searchParams.append('domain', params.domain || '')

      return url.toString()
    },
    method: 'GET',
    isInternalRoute: false,
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      // Extract specific error message from Hunter.io API
      const errorMessage =
        data.errors?.[0]?.details ||
        data.message ||
        `HTTP ${response.status}: Failed to find company data`
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        person: undefined,
        company: data.data
          ? {
              name: data.data.name || '',
              domain: data.data.domain || '',
              industry: data.data.industry || '',
              size: data.data.size || '',
              country: data.data.country || '',
              linkedin: data.data.linkedin || '',
              twitter: data.data.twitter || '',
            }
          : undefined,
      },
    }
  },

  transformError: (error) => {
    if (error instanceof Error) {
      // Return the exact error message from the API
      return error.message
    }
    return 'An unexpected error occurred while finding company data'
  },
}
