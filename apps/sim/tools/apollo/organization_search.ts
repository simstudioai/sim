import type {
  ApolloOrganizationSearchParams,
  ApolloOrganizationSearchResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

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
      description: 'Company HQ locations (cities, US states, or countries)',
    },
    organization_not_locations: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude companies whose HQ is in these locations',
    },
    organization_num_employees_ranges: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Employee count ranges as "min,max" strings (e.g., ["1,10", "250,500", "10000,20000"])',
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
      description: 'Organization name to search for (e.g., "Acme", "TechCorp")',
    },
    organization_ids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apollo organization IDs to include (e.g., ["5e66b6381e05b4008c8331b8"])',
    },
    q_organization_domains_list: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Domain names to filter by (no www. or @, up to 1,000)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (e.g., 1, 2, 3)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page, max 100 (e.g., 25, 50, 100)',
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
      const body: Record<string, unknown> = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }

      if (params.organization_locations?.length) {
        body.organization_locations = params.organization_locations
      }
      if (params.organization_not_locations?.length) {
        body.organization_not_locations = params.organization_not_locations
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
      if (params.organization_ids?.length) {
        body.organization_ids = params.organization_ids
      }
      if (params.q_organization_domains_list?.length) {
        body.q_organization_domains_list = params.q_organization_domains_list
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
        page: data.pagination?.page || 1,
        per_page: data.pagination?.per_page || 25,
        total_entries: data.pagination?.total_entries || 0,
      },
    }
  },

  outputs: {
    organizations: {
      type: 'json',
      description: 'Array of organizations matching the search criteria',
    },
    page: { type: 'number', description: 'Current page number' },
    per_page: { type: 'number', description: 'Results per page' },
    total_entries: { type: 'number', description: 'Total matching entries' },
  },
}
