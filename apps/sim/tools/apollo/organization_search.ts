import type { ToolConfig } from '@/tools/types'
import type { ApolloOrganizationSearchParams, ApolloOrganizationSearchResponse } from './types'

export const apolloOrganizationSearchTool: ToolConfig<
  ApolloOrganizationSearchParams,
  ApolloOrganizationSearchResponse
> = {
  id: 'apollo_organization_search',
  name: 'Apollo Organization Search',
  description: "Search Apollo's database for companies using filters",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    organization_locations: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company locations to search',
    },
    organization_num_employees_ranges: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee count ranges (e.g., ["1-10", "11-50"])',
    },
    q_organization_keyword_tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Industry or keyword tags',
    },
    q_organization_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization name to search for',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max: 100)',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/mixed_companies/search',
    method: 'POST',
    headers: (params: ApolloOrganizationSearchParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloOrganizationSearchParams) => {
      const body: any = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }

      if (params.organization_locations?.length) {
        body.organization_locations = params.organization_locations
      }
      if (params.organization_num_employees_ranges?.length) {
        body.organization_num_employees_ranges = params.organization_num_employees_ranges
      }
      if (params.q_organization_keyword_tags?.length) {
        body.q_organization_keyword_tags = params.q_organization_keyword_tags
      }
      if (params.q_organization_name) {
        body.q_organization_name = params.q_organization_name
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        organizations: data.organizations || [],
        metadata: {
          page: data.pagination?.page || 1,
          per_page: data.pagination?.per_page || 25,
          total_entries: data.pagination?.total_entries || 0,
        },
      },
    }
  },

  outputs: {
    organizations: {
      type: 'json',
      description: 'Array of organizations matching the search criteria',
    },
    metadata: {
      type: 'json',
      description: 'Pagination information including page, per_page, and total_entries',
    },
  },
}
