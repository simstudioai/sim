import {
  API_BASE,
  authHeaders,
  type DataForB2BTypeaheadParams,
  type DataForB2BTypeaheadResponse,
} from '@/tools/dataforb2b/types'
import type { ToolConfig } from '@/tools/types'

export const dataforb2bTypeaheadTool: ToolConfig<
  DataForB2BTypeaheadParams,
  DataForB2BTypeaheadResponse
> = {
  id: 'dataforb2b_typeahead',
  name: 'DataForB2B Typeahead',
  description:
    'Resolve the exact stored value for a free-text filter (company, industry, job title, skill, school, location, investor, category) before a people or company search on DataForB2B. Use it to normalize free text, or when a search returns few or no results.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'DataForB2B API key (https://app.dataforb2b.ai)',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Which kind of value to resolve. One of: company, people_industry, company_industry, category, location, city, region, school, title, skill, investor',
    },
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Free-text query (1-100 chars) to resolve to a stored value',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max suggestions, 1-20 (default 20)',
    },
  },

  request: {
    url: (params) => {
      const limit = Math.max(1, Math.min(Number(params.limit) || 20, 20))
      const qs = new URLSearchParams({
        type: String(params.type),
        q: String(params.q),
        limit: String(limit),
      })
      return `${API_BASE}/typeahead?${qs.toString()}`
    },
    method: 'GET',
    headers: (params) => authHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DataForB2B API error: ${response.status} - ${errorText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        results: data.results || [],
      },
    }
  },

  outputs: {
    results: {
      type: 'json',
      description:
        'Suggestions ordered by popularity; each has the exact stored value to use in a search filter',
    },
  },
}
