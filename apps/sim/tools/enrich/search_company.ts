import type { EnrichSearchCompanyParams, EnrichSearchCompanyResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchCompanyTool: ToolConfig<EnrichSearchCompanyParams, EnrichSearchCompanyResponse> =
  {
    id: 'enrich_search_company',
    name: 'Enrich Search Company',
    description:
      'Search for companies by various criteria including name, industry, location, and size.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Enrich API key',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company name',
      },
      website: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company website URL',
      },
      tagline: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company tagline',
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company type (e.g., Private, Public)',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company description keywords',
      },
      industries: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Industries to filter by (array)',
      },
      locationCountry: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Country',
      },
      locationCity: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'City',
      },
      postalCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Postal code',
      },
      locationCountryList: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Multiple countries to filter by (array)',
      },
      locationCityList: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Multiple cities to filter by (array)',
      },
      specialities: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company specialties (array)',
      },
      followers: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Minimum number of followers',
      },
      staffCount: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum staff count',
      },
      staffCountMin: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Minimum staff count',
      },
      staffCountMax: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum staff count',
      },
      currentPage: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page number (default: 1)',
      },
      pageSize: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Results per page (default: 20)',
      },
    },

    request: {
      url: 'https://api.enrich.so/v1/api/search-company',
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, any> = {}

        if (params.name) body.name = params.name
        if (params.website) body.website = params.website
        if (params.tagline) body.tagline = params.tagline
        if (params.type) body.type = params.type
        if (params.description) body.description = params.description
        if (params.industries) body.industries = params.industries
        if (params.locationCountry) body.location_country = params.locationCountry
        if (params.locationCity) body.location_city = params.locationCity
        if (params.postalCode) body.postal_code = params.postalCode
        if (params.locationCountryList) body.location_country_list = params.locationCountryList
        if (params.locationCityList) body.location_city_list = params.locationCityList
        if (params.specialities) body.specialities = params.specialities
        if (params.followers !== undefined) body.followers = params.followers
        if (params.staffCount !== undefined) body.staff_count = params.staffCount
        if (params.staffCountMin !== undefined) body.staff_count_min = params.staffCountMin
        if (params.staffCountMax !== undefined) body.staff_count_max = params.staffCountMax
        if (params.currentPage) body.current_page = params.currentPage
        if (params.pageSize) body.page_size = params.pageSize

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      const resultData = data.data ?? {}

      const companies =
        resultData.companies?.map((company: any) => ({
          companyName: company.company_name ?? '',
          tagline: company.tagline ?? null,
          webAddress: company.web_address ?? null,
          industries: company.industries ?? [],
          teamSize: company.team_size ?? null,
          linkedInProfile: company.linkedin_profile ?? null,
        })) ?? []

      return {
        success: true,
        output: {
          currentPage: resultData.current_page ?? 1,
          totalPage: resultData.total_page ?? 1,
          pageSize: resultData.page_size ?? 20,
          companies,
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
        description: 'Results per page',
      },
      companies: {
        type: 'array',
        description: 'Search results',
        items: {
          type: 'object',
          properties: {
            companyName: { type: 'string', description: 'Company name' },
            tagline: { type: 'string', description: 'Company tagline' },
            webAddress: { type: 'string', description: 'Website URL' },
            industries: { type: 'array', description: 'Industries' },
            teamSize: { type: 'number', description: 'Team size' },
            linkedInProfile: { type: 'string', description: 'LinkedIn URL' },
          },
        },
      },
    },
  }
