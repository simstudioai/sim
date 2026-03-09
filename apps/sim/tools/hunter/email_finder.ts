import type { HunterEmailFinderParams, HunterEmailFinderResponse } from '@/tools/hunter/types'
import { SOURCES_OUTPUT, VERIFICATION_OUTPUT } from '@/tools/hunter/types'
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
      description: 'Company domain name (e.g., "stripe.com", "company.io")',
    },
    first_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person\'s first name (e.g., "John", "Sarah")',
    },
    last_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person\'s last name (e.g., "Smith", "Johnson")',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (e.g., "Stripe", "Acme Inc")',
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
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

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

  outputs: {
    email: {
      type: 'string',
      description: 'The found email address',
    },
    score: {
      type: 'number',
      description: 'Confidence score (0-100) for the found email address',
    },
    sources: SOURCES_OUTPUT,
    verification: VERIFICATION_OUTPUT,
  },
}
