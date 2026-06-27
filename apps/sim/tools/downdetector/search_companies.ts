import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorSearchCompaniesParams,
  type DowndetectorSearchCompaniesResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  downdetectorNextPageOutput,
  extractDowndetectorError,
  nextPageFromResponse,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

interface RawCompanySummary {
  id?: number
  name?: string
  slug?: string
  url?: string
  country_iso?: string
  category_id?: number
}

export const searchCompaniesTool: ToolConfig<
  DowndetectorSearchCompaniesParams,
  DowndetectorSearchCompaniesResponse
> = {
  id: 'downdetector_search_companies',
  name: 'Downdetector Search Companies',
  description:
    'Search Downdetector for monitored companies by name, slug, country, or category. Returns matching companies with their ids and slugs, which you can use with the other Downdetector operations.',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name to filter on (partial, case-insensitive match). Example: "slack"',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO-2 country code to filter on. Example: "US"',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact company slug to filter on. Example: "optimum-cablevision"',
    },
    categoryId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category id to filter on',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: '1-indexed page number for paginated results (default 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page, between 10 and 100 (default 25)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${DOWNDETECTOR_API_BASE}/companies/search`)
      url.searchParams.set('fields', 'id,name,slug,url,country_iso,category_id')
      if (params.name) url.searchParams.set('name', params.name)
      if (params.country) url.searchParams.set('country', params.country)
      if (params.slug) url.searchParams.set('slug', params.slug)
      if (params.categoryId !== undefined)
        url.searchParams.set('category_id', String(params.categoryId))
      if (params.page !== undefined) url.searchParams.set('page', String(params.page))
      if (params.pageSize !== undefined) url.searchParams.set('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to search companies'))
    }

    const rows: RawCompanySummary[] = Array.isArray(data) ? data : []
    const companies = rows.map((company) => ({
      id: company.id ?? null,
      name: company.name ?? null,
      slug: company.slug ?? null,
      url: company.url ?? null,
      countryIso: company.country_iso ?? null,
      categoryId: company.category_id ?? null,
    }))

    return { success: true, output: { companies, nextPage: nextPageFromResponse(response) } }
  },

  outputs: {
    companies: {
      type: 'array',
      description: 'List of companies matching the search',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Company id' },
          name: { type: 'string', description: 'Company name' },
          slug: { type: 'string', description: 'Company slug' },
          url: { type: 'string', description: 'Company status page URL' },
          countryIso: { type: 'string', description: 'ISO-2 country code' },
          categoryId: { type: 'number', description: 'Category id' },
        },
      },
    },
    nextPage: downdetectorNextPageOutput,
  },
}
