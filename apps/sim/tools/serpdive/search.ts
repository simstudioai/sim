import type { SerpdiveSearchParams, SerpdiveSearchResponse } from '@/tools/serpdive/types'
import { SERPDIVE_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/serpdive/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<SerpdiveSearchParams, SerpdiveSearchResponse> = {
  id: 'serpdive_search',
  name: 'SERPdive Search',
  description:
    'Search the web with SERPdive. Each result carries the extracted, answer-ready content of the page instead of a link or snippet, cleaned and sized for an LLM.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The search query, phrased as a question or topic, in any language (e.g., "what changed in the latest Next.js release"). Maximum 300 characters.',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Retrieval depth: mako (1 credit) returns the fact-carrying sentences of each source, moby (1.5 credits) returns the full readable content of every page (e.g., "mako")',
    },
    answer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Also return a written answer built from the sources: concise on mako, detailed with citations on moby. No extra credits.',
    },
    max_results: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Hard cap on delivered results, keeping the best-ranked ones (1-10, e.g., 5). Omit to get everything relevant.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SERPdive API Key',
    },
  },

  request: {
    url: 'https://api.serpdive.com/v1/search',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      if (params.model) body.model = params.model
      if (params.answer !== undefined) body.answer = params.answer
      if (params.max_results) body.max_results = Number(params.max_results)

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        query: data.query,
        results: (data.results ?? []).map((result: any) => ({
          url: result.url,
          title: result.title ?? null,
          content: result.content,
          date: result.date ?? null,
        })),
        ...(data.model && { model: data.model }),
        ...(data.response_time_ms != null && { response_time_ms: data.response_time_ms }),
        ...(data.answer && { answer: data.answer }),
        ...(data.extra_info && { extra_info: data.extra_info }),
      },
    }
  },

  outputs: {
    query: { type: 'string', description: 'The search query that was executed' },
    results: {
      type: 'array',
      description: 'Delivered sources, best first, each carrying the extracted content of the page',
      items: {
        type: 'object',
        properties: SERPDIVE_SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
    answer: {
      type: 'string',
      description: 'Written answer built from the sources (if requested)',
      optional: true,
    },
    extra_info: {
      type: 'object',
      description:
        'Structured direct-answer block (weather, exchange rates, live scores...) when the query has one',
      optional: true,
    },
    model: {
      type: 'string',
      description: 'The retrieval model that answered: mako or moby',
      optional: true,
    },
    response_time_ms: {
      type: 'number',
      description: 'Time taken for the search request in milliseconds',
      optional: true,
    },
  },
}
