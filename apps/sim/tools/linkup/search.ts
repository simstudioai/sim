import type {
  LinkupSearchParams,
  LinkupSearchResponse,
  LinkupSearchToolResponse,
} from '@/tools/linkup/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<LinkupSearchParams, LinkupSearchToolResponse> = {
  id: 'linkup_search',
  name: 'Linkup Search',
  description: 'Search the web for information using Linkup',
  version: '1.0.0',

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query',
    },
    depth: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search depth (has to either be "standard" or "deep")',
    },
    outputType: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Type of output to return (has to be "sourcedAnswer" or "searchResults")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enter your Linkup API key',
    },
    includeImages: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include images in search results',
    },
    fromDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date for filtering results (YYYY-MM-DD format)',
    },
    toDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date for filtering results (YYYY-MM-DD format)',
    },
    excludeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of domain names to exclude from search results',
    },
    includeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of domain names to restrict search results to',
    },
    includeInlineCitations: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Add inline citations to answers (only applies when outputType is "sourcedAnswer")',
    },
    includeSources: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include sources in response',
    },
  },

  request: {
    url: 'https://api.linkup.so/v1/search',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        q: params.q,
        depth: params.depth,
        outputType: params.outputType,
      }

      if (params.includeImages !== undefined) body.includeImages = params.includeImages
      if (params.fromDate) body.fromDate = params.fromDate
      if (params.toDate) body.toDate = params.toDate

      if (params.excludeDomains) {
        body.excludeDomains = params.excludeDomains
          .split(',')
          .map((d: string) => d.trim())
          .filter((d: string) => d.length > 0)
      }

      if (params.includeDomains) {
        body.includeDomains = params.includeDomains
          .split(',')
          .map((d: string) => d.trim())
          .filter((d: string) => d.length > 0)
      }

      if (params.includeInlineCitations !== undefined)
        body.includeInlineCitations = params.includeInlineCitations

      if (params.includeSources !== undefined) body.includeSources = params.includeSources

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data: LinkupSearchResponse = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    answer: {
      type: 'string',
      description: 'The sourced answer to the search query',
    },
    sources: {
      type: 'array',
      description:
        'Array of sources used to compile the answer, each containing name, url, and snippet',
    },
  },
}
