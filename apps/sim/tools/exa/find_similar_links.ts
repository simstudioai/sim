import type { ExaFindSimilarLinksParams, ExaFindSimilarLinksResponse } from '@/tools/exa/types'
import {
  applyFreshness,
  parseCommaList,
  requireCostTotal,
  resolveCategory,
} from '@/tools/exa/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Exa has deprecated `/findSimilar` in favor of running a `/search` with a query
 * derived from the seed page. The endpoint still serves traffic, so this tool
 * remains available for workflows already built on it.
 */
export const findSimilarLinksTool: ToolConfig<
  ExaFindSimilarLinksParams,
  ExaFindSimilarLinksResponse
> = {
  id: 'exa_find_similar_links',
  name: 'Exa Find Similar Links',
  description:
    'Find webpages similar to a given URL using Exa AI. Deprecated by Exa in favor of Search — prefer Search for new workflows.',
  version: '2.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL to find similar links for',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of similar links to return (1-100). Default: 10',
    },
    text: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include the full text of the similar pages',
    },
    includeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of domains to include in results (e.g., "github.com, stackoverflow.com")',
    },
    excludeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of domains to exclude from results (e.g., "reddit.com, pinterest.com")',
    },
    excludeSourceDomain: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Exclude the source domain from results (default: false)',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Filter by category: company, publication, news, personal site, financial report, people',
    },
    highlights: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include highlighted snippets in results (default: false)',
    },
    summary: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include AI-generated summaries in results (default: false)',
    },
    maxAgeHours: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description:
        'Cache freshness in hours (-1 to 720). 0 always crawls live, -1 uses cache only. Cannot be combined with livecrawl.',
    },
    livecrawlTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Live crawl timeout in milliseconds (max 90000). Default: 10000',
    },
    livecrawl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Deprecated: use maxAgeHours instead. Live crawling mode: never, fallback, always, or preferred',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
  },
  hosting: {
    envKeyPrefix: 'EXA_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'exa',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const cost = requireCostTotal(output, 'find_similar_links')
        return { cost, metadata: { costDollars: output.__costDollars } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 10,
    },
  },

  request: {
    url: 'https://api.exa.ai/findSimilar',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        url: params.url,
      }

      if (params.numResults) body.numResults = Number(params.numResults)

      const includeDomains = parseCommaList(params.includeDomains)
      if (includeDomains) body.includeDomains = includeDomains
      const excludeDomains = parseCommaList(params.excludeDomains)
      if (excludeDomains) body.excludeDomains = excludeDomains
      if (params.excludeSourceDomain !== undefined) {
        body.excludeSourceDomain = params.excludeSourceDomain
      }

      const category = resolveCategory(params.category)
      if (category) body.category = category

      const contents: Record<string, any> = {}
      if (params.text !== undefined) contents.text = params.text
      if (params.highlights !== undefined) contents.highlights = params.highlights
      if (params.summary !== undefined) contents.summary = params.summary

      applyFreshness(contents, params)

      if (Object.keys(contents).length > 0) {
        body.contents = contents
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        similarLinks: (data.results ?? []).map((result: any) => ({
          id: result.id,
          title: result.title || '',
          url: result.url,
          text: result.text || '',
          summary: result.summary,
          highlights: result.highlights,
          score: result.score,
        })),
        requestId: data.requestId,
        __costDollars: data.costDollars,
      },
    }
  },

  outputs: {
    similarLinks: {
      type: 'array',
      description: 'Similar links found with titles, URLs, and text snippets',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exa identifier for the similar page' },
          title: { type: 'string', description: 'The title of the similar webpage' },
          url: { type: 'string', description: 'The URL of the similar webpage' },
          text: {
            type: 'string',
            description: 'Text snippet or full content from the similar webpage',
          },
          summary: { type: 'string', description: 'AI-generated summary of the similar webpage' },
          highlights: {
            type: 'array',
            description: 'Relevant snippets extracted from the page',
            items: { type: 'string' },
          },
          score: {
            type: 'number',
            description: 'Similarity score indicating how similar the page is',
          },
        },
      },
    },
    requestId: { type: 'string', description: 'Exa request identifier, useful for support' },
  },
}
