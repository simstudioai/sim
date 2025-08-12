import type { HunterDiscoverParams, HunterDiscoverResponse } from '@/tools/hunter/types'
import type { ToolConfig } from '@/tools/types'

export const discoverTool: ToolConfig<HunterDiscoverParams, HunterDiscoverResponse> = {
  id: 'hunter_discover',
  name: 'Hunter Discover',
  description: 'Returns companies matching a set of criteria using Hunter.io AI-powered search.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Natural language search query for companies',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain names to filter by',
    },
    headcount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company size filter (e.g., "1-10", "11-50")',
    },
    company_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Type of organization',
    },
    technology: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Technology used by companies',
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
      // Validate that at least one search parameter is provided
      if (
        !params.query &&
        !params.domain &&
        !params.headcount &&
        !params.company_type &&
        !params.technology
      ) {
        throw new Error(
          'At least one search parameter (query, domain, headcount, company_type, or technology) must be provided'
        )
      }

      const url = new URL('https://api.hunter.io/v2/discover')
      url.searchParams.append('api_key', params.apiKey)
      return url.toString()
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      // Add optional parameters if provided
      if (params.query) body.query = params.query
      if (params.domain) body.organization = { domain: [params.domain] }
      if (params.headcount) body.headcount = params.headcount
      if (params.company_type) body.company_type = params.company_type
      if (params.technology) {
        body.technology = {
          include: [params.technology],
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        results:
          data.data?.map((company: any) => ({
            domain: company.domain || '',
            name: company.organization || '',
            headcount: company.headcount,
            technologies: company.technologies || [],
            email_count: company.emails_count?.total || 0,
          })) || [],
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description:
        'Array of companies matching the search criteria, each containing domain, name, headcount, technologies, and email_count',
    },
  },
}
