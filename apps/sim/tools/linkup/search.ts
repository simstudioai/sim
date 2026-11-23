import type {
  LinkupSearchParams,
  LinkupSearchResponse,
  LinkupSearchToolResponse,
} from '@/tools/linkup/types'
import type { ToolConfig } from '@/tools/types'

/** Price per search by depth tier: raw `searchResults`, or an answer (any other or unset output type). */
const LINKUP_SEARCH_COST = {
  standard: { searchResults: 0.005, answer: 0.006 },
  deep: { searchResults: 0.05, answer: 0.055 },
} as const

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
      description: 'The search query (e.g., "latest AI research papers 2024")',
    },
    depth: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search depth: "flash" (lowest latency), "fast" (one-shot retrieval), "standard" (single agentic pass), or "deep" (multi-step, most thorough)',
    },
    outputType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Output format: "sourcedAnswer" for AI-generated answer with citations, "searchResults" for raw results',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (at least 1)',
    },
  },

  hosting: {
    envKeyPrefix: 'LINKUP_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'linkup',
    pricing: {
      type: 'custom',
      /** USD per call from https://docs.linkup.so/pages/documentation/platform/pricing. */
      getCost: (params) => {
        const depth = params.depth as string
        const outputType = params.outputType as string
        const tier = depth === 'deep' ? 'deep' : 'standard'
        const cost =
          LINKUP_SEARCH_COST[tier][outputType === 'searchResults' ? 'searchResults' : 'answer']
        return { cost, metadata: { depth, outputType } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => (params.outputType === 'sourcedAnswer' ? { q: params.q } : {}),
    },
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

      if (params.maxResults != null && String(params.maxResults).trim() !== '') {
        const maxResults = Number(params.maxResults)
        if (!Number.isInteger(maxResults) || maxResults < 1) {
          throw new Error('Linkup Max Results must be a whole number of at least 1')
        }
        body.maxResults = maxResults
      }

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
      description: 'The sourced answer to the search query (Answer output type)',
      optional: true,
    },
    sources: {
      type: 'array',
      description: 'Sources used to compile the answer (Answer output type)',
      optional: true,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Title of the source' },
          url: { type: 'string', description: 'URL of the source' },
          snippet: { type: 'string', description: 'Text extracted from the source' },
          favicon: { type: 'string', description: 'Favicon URL', optional: true },
          publishedAt: { type: 'string', description: 'Publication date', optional: true },
        },
      },
    },
    results: {
      type: 'array',
      description: 'Ranked text and image results (Search output type)',
      optional: true,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Result type: text or image' },
          name: { type: 'string', description: 'Title of the result' },
          url: { type: 'string', description: 'URL of the result' },
          content: {
            type: 'string',
            description: 'Extracted text content (text results)',
            optional: true,
          },
          favicon: { type: 'string', description: 'Favicon URL', optional: true },
          publishedAt: { type: 'string', description: 'Publication date', optional: true },
        },
      },
    },
  },
}
