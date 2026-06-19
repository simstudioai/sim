import {
  API_BASE,
  authHeaders,
  type DataForB2BSearchParams,
  type DataForB2BSearchResponse,
  parseJson,
} from '@/tools/dataforb2b/types'
import type { ToolConfig } from '@/tools/types'

export const dataforb2bSearchCompaniesTool: ToolConfig<
  DataForB2BSearchParams,
  DataForB2BSearchResponse
> = {
  id: 'dataforb2b_search_companies',
  name: 'DataForB2B Search Companies',
  description:
    'Search companies and accounts by structured filters (industry, headcount/size, location, founded year, funding stage/amount, growth, keywords and LinkedIn data) with DataForB2B. Build target account lists for B2B sales and account-based marketing.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'DataForB2B API key (https://app.dataforb2b.ai)',
    },
    filters: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Structured filters as JSON: {"op":"and"|"or","conditions":[{"column","type","value","value2"?}]}. Columns: name, tagline, description, domain, universal_name, keyword, industry, employee_count, country_iso_code, city, region, office_country, office_city, office_region, employee_growth_1m, employee_growth_6m, employee_growth_12m, recent_hires_count, founded_year, company_type, follower_count, page_verified, category, last_funding_amount_usd, last_funding_date, funding_stage_normalized, has_funding. Operators (type): =, !=, like, not_like, in, not_in, >, >=, <, <=, between. Use an array value for "in"/"not_in"; for "between" set value (min) and value2 (max). Example: {"op":"and","conditions":[{"column":"industry","type":"like","value":"software development"},{"column":"employee_count","type":"between","value":51,"value2":500},{"column":"funding_stage_normalized","type":"in","value":["series_a","series_b"]}]}',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max results to return (default 25, max 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset, e.g. 25, 50 (default 0)',
    },
  },

  request: {
    url: `${API_BASE}/search/companies`,
    method: 'POST',
    headers: (params) => authHeaders(params.apiKey),
    body: (params) => ({
      filters: parseJson(params.filters),
      count: Math.min(Number(params.count) || 25, 100),
      offset: Number(params.offset) || 0,
      enrich_live: false,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DataForB2B API error: ${response.status} - ${errorText}`)
    }
    const data = await response.json()
    const results = data.results || []
    return {
      success: true,
      output: {
        results,
        total: data.total ?? 0,
        count: data.count ?? results.length,
      },
    }
  },

  outputs: {
    results: {
      type: 'json',
      description:
        'Array of matching companies: each with name, domain, industry, headcount, location, funding and LinkedIn data',
    },
    total: { type: 'number', description: 'Total number of companies matching the filters' },
    count: { type: 'number', description: 'Number of companies returned in this page' },
  },
}
