import type { HunterEmailCountParams, HunterEmailCountResponse } from '@/tools/hunter/types'
import type { ToolConfig } from '@/tools/types'

export const emailCountTool: ToolConfig<HunterEmailCountParams, HunterEmailCountResponse> = {
  id: 'hunter_email_count',
  name: 'Hunter Email Count',
  description: 'Returns the total number of email addresses found for a domain or company.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Domain to count emails for (required if company not provided)',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name to count emails for (required if domain not provided)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter for personal or generic emails only',
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
      if (!params.domain && !params.company) {
        throw new Error('Either domain or company must be provided')
      }

      const url = new URL('https://api.hunter.io/v2/email-count')
      url.searchParams.append('api_key', params.apiKey)

      if (params.domain) url.searchParams.append('domain', params.domain)
      if (params.company) url.searchParams.append('company', params.company)
      if (params.type && params.type !== 'all') url.searchParams.append('type', params.type)

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
        data.errors?.[0]?.details || data.message || 'Failed to perform Hunter email count'
      )
    }

    return {
      success: true,
      output: {
        total: data.data?.total || 0,
        personal_emails: data.data?.personal_emails || 0,
        generic_emails: data.data?.generic_emails || 0,
        department: data.data?.department || {
          executive: 0,
          it: 0,
          finance: 0,
          management: 0,
          sales: 0,
          legal: 0,
          support: 0,
          hr: 0,
          marketing: 0,
          communication: 0,
        },
        seniority: data.data?.seniority || {
          junior: 0,
          senior: 0,
          executive: 0,
        },
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error
      ? error.message
      : 'An error occurred while performing the Hunter email count'
  },
}
