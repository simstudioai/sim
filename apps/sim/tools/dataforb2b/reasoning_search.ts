import {
  API_BASE,
  authHeaders,
  type DataForB2BReasoningParams,
  type DataForB2BReasoningResponse,
  parseJson,
} from '@/tools/dataforb2b/types'
import type { ToolConfig } from '@/tools/types'

export const dataforb2bReasoningSearchTool: ToolConfig<
  DataForB2BReasoningParams,
  DataForB2BReasoningResponse
> = {
  id: 'dataforb2b_reasoning_search',
  name: 'DataForB2B Reasoning Search',
  description:
    'Natural-language search for people, leads or companies with DataForB2B. Describe your ideal lead or ICP in plain English (e.g. \'marketing directors at Series A SaaS startups in France\'). If the response status is "needs_input", call again with session_id and an answers object.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'DataForB2B API key (https://app.dataforb2b.ai)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Natural-language description of the ideal lead/company (ICP). Required on the first call.',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search "people" or "companies" (default people)',
    },
    max_results: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max results, 1-100 (default 25)',
    },
    session_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Session id from a previous "needs_input" response, to refine the search.',
    },
    answers: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Answers to clarifying questions as a {question_id: answer} object, for a needs_input turn.',
    },
  },

  request: {
    url: `${API_BASE}/search/reasoning`,
    method: 'POST',
    headers: (params) => authHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        category: params.category || 'people',
        max_results: Number(params.max_results) || 25,
        enrich_live: false,
      }
      if (params.query) body.query = params.query
      if (params.session_id) body.session_id = params.session_id
      const answers = parseJson(params.answers)
      if (answers) body.answers = answers
      return body
    },
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
        status: data.status ?? 'ok',
        results: data.results || [],
        total: data.total ?? 0,
        count: data.count ?? (data.results?.length || 0),
        session_id: data.session_id ?? null,
        questions: data.questions || [],
        applied_filters: data.applied_filters ?? null,
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: '"needs_input" when clarification is required, otherwise the search status',
    },
    results: { type: 'json', description: 'Array of matching people or companies' },
    total: { type: 'number', description: 'Total number of matches' },
    count: { type: 'number', description: 'Number of results returned' },
    session_id: {
      type: 'string',
      description: 'Session id to pass back with answers when status is needs_input',
      optional: true,
    },
    questions: {
      type: 'json',
      description: 'Clarifying questions [{id, text, suggestions}] when status is needs_input',
    },
    applied_filters: {
      type: 'json',
      description:
        'Structured filters the agent applied; reuse with search/people|companies for paging',
    },
  },
}
