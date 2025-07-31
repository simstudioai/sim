import type { HunterEmailFinderParams, HunterEmailFinderResponse } from '@/tools/hunter/types'
import type { ToolConfig } from '@/tools/types'

export const emailFinderTool: ToolConfig<HunterEmailFinderParams, HunterEmailFinderResponse> = {
  id: 'hunter_email_finder',
  name: 'Hunter Email Finder',
  description:
    'Finds the most likely email address for a person given their name and company domain.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain name',
    },
    first_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Person's first name",
    },
    last_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Person's last name",
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
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
      const url = new URL('https://api.hunter.io/v2/email-finder')
      url.searchParams.append('domain', params.domain)
      url.searchParams.append('first_name', params.first_name)
      url.searchParams.append('last_name', params.last_name)
      url.searchParams.append('api_key', params.apiKey)

      if (params.company) url.searchParams.append('company', params.company)

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
      throw new Error(
        data.errors?.[0]?.details || data.message || 'Failed to perform Hunter email finder'
      )
    }

    return {
      success: true,
      output: {
        email: data.data?.email || '',
        score: data.data?.score || 0,
        sources: data.data?.sources || [],
        verification: data.data?.verification || {},
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error
      ? error.message
      : 'An error occurred while performing the Hunter email finder'
  },
}
