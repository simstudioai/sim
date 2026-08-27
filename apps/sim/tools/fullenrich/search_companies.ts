import { fullEnrichExactHosting } from '@/tools/fullenrich/hosting'
import {
  fullEnrichCompanyFiltersSchema,
  fullEnrichSearchCompaniesResponseSchema,
  fullEnrichSearchPaginationSchema,
} from '@/tools/fullenrich/schemas'
import {
  FULLENRICH_COMPANY_OUTPUT,
  type FullEnrichSearchCompaniesResponse,
  type FullEnrichSearchParams,
} from '@/tools/fullenrich/types'
import {
  extractFullEnrichError,
  parseFullEnrichInput,
  requireFullEnrichCredits,
} from '@/tools/fullenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const searchCompaniesTool: ToolConfig<
  FullEnrichSearchParams,
  FullEnrichSearchCompaniesResponse
> = {
  id: 'fullenrich_search_companies',
  name: 'FullEnrich Search Companies',
  description:
    'Search FullEnrich companies by name, domain, professional network, keywords, industry, type, location, founding year, and headcount.',
  version: '1.0.0',
  hosting: fullEnrichExactHosting((_params, output) =>
    requireFullEnrichCredits(output.credits, 'FullEnrich response credits')
  ),
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'FullEnrich API key',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Official company-search filter object. Supported keys: names, domains, professional_network_ids, professional_network_urls, keywords, specialties, industries, types, headquarters_locations, founded_years, headcounts, and company_ids.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of companies to skip, from 0 to 10,000',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of companies to return, from 1 to 100; defaults to 10',
    },
    searchAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor returned by the previous response for cursor-based pagination',
    },
  },
  request: {
    url: 'https://app.fullenrich.com/api/v2/company/search',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const filters = parseFullEnrichInput(
        params.filters ?? {},
        fullEnrichCompanyFiltersSchema,
        'Company filters'
      )
      const pagination = fullEnrichSearchPaginationSchema.parse({
        offset: params.offset,
        limit: params.limit,
        search_after: params.searchAfter,
      })
      return { ...filters, ...pagination }
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await extractFullEnrichError(response))
    const data = fullEnrichSearchCompaniesResponseSchema.parse(await response.json())
    return {
      success: true,
      output: {
        companies: data.companies,
        total: data.metadata.total,
        credits: data.metadata.credits,
        offset: data.metadata.offset,
        searchAfter: data.metadata.search_after ?? null,
      },
    }
  },
  outputs: {
    companies: FULLENRICH_COMPANY_OUTPUT,
    total: { type: 'number', description: 'Total number of matching companies' },
    credits: { type: 'number', description: 'Credits reported by FullEnrich for this request' },
    offset: { type: 'number', description: 'Number of results skipped' },
    searchAfter: {
      type: 'string',
      description: 'Cursor for the next page',
      optional: true,
      nullable: true,
    },
  },
}
