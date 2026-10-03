import type {
  AffinitySemanticSearchParams,
  AffinitySemanticSearchResponse,
} from '@/tools/affinity/types'
import { SEMANTIC_SEARCH_COMPANY_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityError,
  affinityHeaders,
  buildAffinityUrl,
  parseNumberList,
  readAffinityJson,
  requireParam,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinitySemanticSearchTool: ToolConfig<
  AffinitySemanticSearchParams,
  AffinitySemanticSearchResponse
> = {
  id: 'affinity_semantic_search',
  name: 'Affinity Semantic Search',
  description:
    'Find companies from a description in plain language — industry, technology, stage, or business model. Currently searches companies only.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'What to look for, in plain language, e.g. "climate tech companies in our pipeline". Up to 500 characters',
    },
    listIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict the search to companies on these lists, e.g. [1, 2]',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of companies to return, 1-100. Defaults to 100',
    },
  },

  request: {
    url: () => buildAffinityUrl('/semantic-search'),
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => {
      const body: Record<string, unknown> = {
        prompt: requireParam(params.prompt, 'prompt'),
        entityType: 'companies',
      }
      const listIds = parseNumberList(params.listIds, 'listIds')
      if (listIds) body.listIds = listIds
      if (params.limit !== undefined) body.limit = params.limit
      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) throw await affinityError(response)

    const data = await readAffinityJson<{
      data?: unknown[] | null
      entityType?: string
      explanation?: string
    }>(response)
    const companies = data.data ?? []

    return {
      success: true,
      output: {
        companies,
        count: companies.length,
        entityType: data.entityType ?? 'companies',
        explanation: data.explanation ?? '',
      },
    }
  },

  outputs: {
    companies: {
      type: 'array',
      description: 'Matching companies, best match first',
      items: { type: 'object', properties: SEMANTIC_SEARCH_COMPANY_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of companies returned' },
    entityType: { type: 'string', description: 'The entity kind that was searched' },
    explanation: { type: 'string', description: 'How the search read the prompt' },
  },
}
