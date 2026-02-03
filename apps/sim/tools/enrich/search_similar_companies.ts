import type {
  EnrichSearchSimilarCompaniesParams,
  EnrichSearchSimilarCompaniesResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchSimilarCompaniesTool: ToolConfig<
  EnrichSearchSimilarCompaniesParams,
  EnrichSearchSimilarCompaniesResponse
> = {
  id: 'enrich_search_similar_companies',
  name: 'Enrich Search Similar Companies',
  description:
    'Find companies similar to a given company by LinkedIn URL with filters for location and size.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn company URL (e.g., linkedin.com/company/google)',
    },
    accountLocation: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by locations (array of country names)',
    },
    employeeSizeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee size filter type (e.g., RANGE)',
    },
    employeeSizeRange: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Employee size ranges (array of {start, end} objects)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
    },
    num: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page',
    },
  },

  request: {
    url: 'https://api.enrich.so/v1/api/similar-companies',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url.trim(),
      }

      if (params.accountLocation) {
        body.account = body.account ?? {}
        body.account.location = params.accountLocation
      }

      if (params.employeeSizeType || params.employeeSizeRange) {
        body.account = body.account ?? {}
        body.account.employeeSize = {
          type: params.employeeSizeType ?? 'RANGE',
          range: params.employeeSizeRange ?? [],
        }
      }

      if (params.page) body.page = params.page
      if (params.num) body.num = params.num

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const content = data.data?.content ?? []

    const companies = content.map((company: any) => ({
      url: company.url ?? null,
      name: company.name ?? null,
      universalName: company.universalName ?? null,
      type: company.type ?? null,
      description: company.description ?? null,
      phone: company.phone ?? null,
      website: company.website ?? null,
      logo: company.logo ?? null,
      foundedYear: company.foundedYear ?? null,
      staffTotal: company.staff?.total ?? null,
      industries: company.industries ?? [],
      relevancyScore: company.relevancy?.score ?? null,
      relevancyValue: company.relevancy?.value ?? null,
    }))

    return {
      success: true,
      output: {
        companies,
      },
    }
  },

  outputs: {
    companies: {
      type: 'array',
      description: 'Similar companies',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'LinkedIn URL' },
          name: { type: 'string', description: 'Company name' },
          universalName: { type: 'string', description: 'Universal name' },
          type: { type: 'string', description: 'Company type' },
          description: { type: 'string', description: 'Description' },
          phone: { type: 'string', description: 'Phone number' },
          website: { type: 'string', description: 'Website URL' },
          logo: { type: 'string', description: 'Logo URL' },
          foundedYear: { type: 'number', description: 'Year founded' },
          staffTotal: { type: 'number', description: 'Total staff' },
          industries: { type: 'array', description: 'Industries' },
          relevancyScore: { type: 'number', description: 'Relevancy score' },
          relevancyValue: { type: 'string', description: 'Relevancy value' },
        },
      },
    },
  },
}
