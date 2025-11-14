import type { ToolConfig } from '@/tools/types'
import type { ApolloPeopleSearchParams, ApolloPeopleSearchResponse } from './types'

export const apolloPeopleSearchTool: ToolConfig<
  ApolloPeopleSearchParams,
  ApolloPeopleSearchResponse
> = {
  id: 'apollo_people_search',
  name: 'Apollo People Search',
  description: "Search Apollo's database for people using demographic filters",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    person_titles: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job titles to search for (e.g., ["CEO", "VP of Sales"])',
    },
    person_locations: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Locations to search in (e.g., ["San Francisco, CA", "New York, NY"])',
    },
    person_seniorities: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seniority levels (e.g., ["senior", "executive", "manager"])',
    },
    organization_names: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company names to search within',
    },
    q_keywords: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keywords to search for',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (default: 1)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (default: 25, max: 100)',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/mixed_people/search',
    method: 'POST',
    headers: (params: ApolloPeopleSearchParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloPeopleSearchParams) => {
      const body: any = {
        page: params.page || 1,
        per_page: Math.min(params.per_page || 25, 100),
      }

      if (params.person_titles && params.person_titles.length > 0) {
        body.person_titles = params.person_titles
      }
      if (params.person_locations && params.person_locations.length > 0) {
        body.person_locations = params.person_locations
      }
      if (params.person_seniorities && params.person_seniorities.length > 0) {
        body.person_seniorities = params.person_seniorities
      }
      if (params.organization_names && params.organization_names.length > 0) {
        body.organization_names = params.organization_names
      }
      if (params.q_keywords) {
        body.q_keywords = params.q_keywords
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
        people: data.people || [],
        metadata: {
          page: data.pagination?.page || 1,
          per_page: data.pagination?.per_page || 25,
          total_entries: data.pagination?.total_entries || 0,
        },
      },
    }
  },

  outputs: {
    people: { type: 'json', description: 'Array of people matching the search criteria' },
    metadata: {
      type: 'json',
      description: 'Pagination information including page, per_page, and total_entries',
    },
  },
}
