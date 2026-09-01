import type {
  MintlifySearchParams,
  MintlifySearchResponse,
  MintlifySearchResult,
} from '@/tools/mintlify/types'
import {
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableString,
  toStringArray,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifySearchTool: ToolConfig<MintlifySearchParams, MintlifySearchResponse> = {
  id: 'mintlify_search',
  name: 'Mintlify Search Documentation',
  description:
    'Run a semantic and keyword search across a Mintlify documentation site, with optional version, language, tag, and group filters.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Domain identifier from your domain.mintlify.site URL, found at the end of your dashboard URL',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query to execute against your documentation content',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of search results to return, between 1 and 50 (default 10)',
    },
    scoreThreshold: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum relevance score for results, between 0 and 1',
    },
    version: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter results by documentation version',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter results by content language',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter results by tag',
    },
    groups: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documentation groups the caller is authorized to access, as a JSON array of strings. Only applies to deployments using auth or userAuth.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify assistant API key (starts with mint_dsc_)',
    },
  },

  request: {
    url: (params) => `${MINTLIFY_API_BASE}/discovery/v1/search/${pathSegment(params.domain)}`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { query: params.query }

      if (params.pageSize !== undefined) body.pageSize = params.pageSize
      if (params.scoreThreshold !== undefined) body.scoreThreshold = params.scoreThreshold

      const groups = toStringArray(params.groups)
      const filter: Record<string, unknown> = {}
      if (params.version) filter.version = params.version
      if (params.language) filter.language = params.language
      if (params.tag) filter.tag = params.tag
      if (groups) filter.groups = groups
      if (Object.keys(filter).length > 0) body.filter = filter

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to search Mintlify documentation')
    const rows = Array.isArray(data) ? data : []

    const results: MintlifySearchResult[] = rows.map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      return {
        content: toNullableString(row.content),
        path: toNullableString(row.path),
        metadata:
          row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>)
            : null,
      }
    })

    return {
      success: true,
      output: {
        results,
        resultCount: results.length,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Matching documentation chunks ordered by relevance',
      items: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The matching content from your documentation',
            nullable: true,
          },
          path: {
            type: 'string',
            description: 'Path or URL to the source document',
            nullable: true,
          },
          metadata: {
            type: 'json',
            description: 'Additional metadata about the search result',
            nullable: true,
          },
        },
      },
    },
    resultCount: { type: 'number', description: 'Number of results returned' },
  },
}
