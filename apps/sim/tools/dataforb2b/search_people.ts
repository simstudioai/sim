import {
  API_BASE,
  authHeaders,
  type DataForB2BSearchParams,
  type DataForB2BSearchResponse,
  parseJson,
} from '@/tools/dataforb2b/types'
import type { ToolConfig } from '@/tools/types'

export const dataforb2bSearchPeopleTool: ToolConfig<
  DataForB2BSearchParams,
  DataForB2BSearchResponse
> = {
  id: 'dataforb2b_search_people',
  name: 'DataForB2B Search People',
  description:
    'Search people and B2B leads by structured filters (job title, current company, location, industry, seniority, skills, school, funding and LinkedIn data) with DataForB2B. Find employees at a company, decision-makers and key contacts for sales prospecting.',
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
        'Structured filters as JSON: {"op":"and"|"or","conditions":[{"column","type","value","value2"?}]}. Columns: first_name, last_name, profile_location, profile_country, profile_industry, follower_count, keyword, current_company, current_title, current_job_location, current_company_industry, current_company_category, current_company_size, current_company_id, current_employment_type, years_in_current_position, years_at_current_company, current_company_has_funding, current_company_funding_stage, current_company_investor, past_company, past_title, past_job_location, past_company_industry, past_company_size, past_company_id, past_employment_type, years_at_past_company, skill, school, degree, degree_level, field_of_study, language, language_iso, language_proficiency, certification, certification_authority, years_of_experience, num_total_jobs, is_currently_employed. Operators (type): =, !=, like, not_like, in, not_in, >, >=, <, <=, between. Use an array value for "in"/"not_in"; for "between" set value (min) and value2 (max). Example: {"op":"and","conditions":[{"column":"current_title","type":"like","value":"Head of Growth"},{"column":"current_company_size","type":"in","value":["51-200","201-500"]}]}',
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
    url: `${API_BASE}/search/people`,
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
        'Array of matching people: each with profile, current role/company, location, industry, skills and LinkedIn URL',
    },
    total: { type: 'number', description: 'Total number of people matching the filters' },
    count: { type: 'number', description: 'Number of people returned in this page' },
  },
}
