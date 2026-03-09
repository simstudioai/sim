import type {
  EnrichSearchCompanyEmployeesParams,
  EnrichSearchCompanyEmployeesResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchCompanyEmployeesTool: ToolConfig<
  EnrichSearchCompanyEmployeesParams,
  EnrichSearchCompanyEmployeesResponse
> = {
  id: 'enrich_search_company_employees',
  name: 'Enrich Search Company Employees',
  description: 'Search for employees within specific companies by location and job title.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    companyIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of company IDs to search within',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country filter (e.g., United States)',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City filter (e.g., San Francisco)',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State filter (e.g., California)',
    },
    jobTitles: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job titles to filter by (array)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (default: 10)',
    },
  },

  request: {
    url: 'https://api.enrich.so/v1/api/search-company-employees',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.companyIds) body.companyIds = params.companyIds
      if (params.country) body.country = params.country
      if (params.city) body.city = params.city
      if (params.state) body.state = params.state
      if (params.jobTitles) body.jobTitles = params.jobTitles
      if (params.page) body.page = params.page
      if (params.pageSize) body.page_size = params.pageSize

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const resultData = data.data ?? {}

    const profiles =
      resultData.profiles?.map((profile: any) => ({
        profileIdentifier: profile.profile_identifier ?? '',
        givenName: profile.given_name ?? null,
        familyName: profile.family_name ?? null,
        currentPosition: profile.current_position ?? null,
        profileImage: profile.profile_image ?? null,
        externalProfileUrl: profile.external_profile_url ?? null,
        city: profile.residence?.city ?? null,
        country: profile.residence?.country ?? null,
        expertSkills: profile.expert_skills ?? [],
      })) ?? []

    return {
      success: true,
      output: {
        currentPage: resultData.current_page ?? 1,
        totalPage: resultData.total_page ?? 1,
        pageSize: resultData.page_size ?? profiles.length,
        profiles,
      },
    }
  },

  outputs: {
    currentPage: {
      type: 'number',
      description: 'Current page number',
    },
    totalPage: {
      type: 'number',
      description: 'Total number of pages',
    },
    pageSize: {
      type: 'number',
      description: 'Number of results per page',
    },
    profiles: {
      type: 'array',
      description: 'Employee profiles',
      items: {
        type: 'object',
        properties: {
          profileIdentifier: { type: 'string', description: 'Profile ID' },
          givenName: { type: 'string', description: 'First name' },
          familyName: { type: 'string', description: 'Last name' },
          currentPosition: { type: 'string', description: 'Current job title' },
          profileImage: { type: 'string', description: 'Profile image URL' },
          externalProfileUrl: { type: 'string', description: 'LinkedIn URL' },
          city: { type: 'string', description: 'City' },
          country: { type: 'string', description: 'Country' },
          expertSkills: { type: 'array', description: 'Skills' },
        },
      },
    },
  },
}
