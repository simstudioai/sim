import {
  extractProspeoError,
  PROSPEO_PAGINATION_OUTPUT,
  type ProspeoSearchCompanyParams,
  type ProspeoSearchCompanyResponse,
} from '@/tools/prospeo/types'
import { parseFiltersObject } from '@/tools/prospeo/utils'
import type { ToolConfig } from '@/tools/types'

export const searchCompanyTool: ToolConfig<
  ProspeoSearchCompanyParams,
  ProspeoSearchCompanyResponse
> = {
  id: 'prospeo_search_company',
  name: 'Prospeo Search Company',
  description: 'Search for companies using 20+ filters to build account lists.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Prospeo API key',
    },
    filters: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Filter configuration object. See https://prospeo.io/api-docs/filters-documentation for all supported filters (e.g., company_industry, company_headcount_range, company_funding).',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (defaults to 1). Up to 1000 pages of 25 results.',
    },
  },

  request: {
    url: 'https://api.prospeo.io/search-company',
    method: 'POST',
    headers: (params) => ({
      'X-KEY': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { filters: parseFiltersObject(params.filters) }
      if (params.page !== undefined) body.page = params.page
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await extractProspeoError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        free: data.free ?? false,
        results: data.results ?? [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    free: {
      type: 'boolean',
      description: 'True if the request was free due to 30-day result-set deduplication',
    },
    results: {
      type: 'array',
      description: 'Up to 25 matching companies',
      items: {
        type: 'object',
        properties: {
          company: { type: 'json', description: 'Matched company object' },
        },
      },
    },
    pagination: PROSPEO_PAGINATION_OUTPUT,
  },
}
