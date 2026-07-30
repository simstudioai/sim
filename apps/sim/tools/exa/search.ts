import type { ExaSearchParams, ExaSearchResponse } from '@/tools/exa/types'
import {
  applyFreshness,
  buildExtras,
  parseCommaList,
  parseJsonSchema,
  requireCostTotal,
  resolveCategory,
} from '@/tools/exa/utils'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<ExaSearchParams, ExaSearchResponse> = {
  id: 'exa_search',
  name: 'Exa Search',
  description:
    'Search the web using Exa AI. Returns relevant search results with titles, URLs, and text snippets.',
  version: '2.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to execute',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (1-100). Default: 10',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search type: "instant", "fast", "auto", "deep-lite", "deep", or "deep-reasoning". Default: "auto"',
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
    category: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Filter by category: company, publication, news, personal site, financial report, people',
    },
    text: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include full text content in results (default: false)',
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
    summaryQuery: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Query to focus the generated summaries on a specific question',
    },
    subpages: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of subpages to crawl per result (0-100). Default: 0',
    },
    subpageTarget: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Comma-separated keywords to target specific subpages (e.g., "docs,pricing,about")',
    },
    extrasLinks: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of links to extract from each result page (0-1000). Default: 0',
    },
    extrasImageLinks: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of image URLs to extract from each result page (0-1000). Default: 0',
    },
    outputSchema: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON Schema describing a synthesized answer to build from the results. Returned in structuredOutput.',
    },
    systemPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional guidance for generating the synthesized output',
    },
    userLocation: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Two-letter ISO country code to localize results (e.g., "US")',
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
    startPublishedDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only include results published on or after this ISO 8601 date (e.g., "2024-01-01" or "2024-01-01T00:00:00.000Z")',
    },
    endPublishedDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include results published on or before this ISO 8601 date',
    },
    startCrawlDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deprecated: use startPublishedDate. Only include results crawled on or after this ISO 8601 date',
    },
    endCrawlDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Deprecated: use endPublishedDate. Only include results crawled on or before this ISO 8601 date',
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
        const cost = requireCostTotal(output, 'search')
        return { cost, metadata: { costDollars: output.__costDollars } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  },

  request: {
    url: 'https://api.exa.ai/search',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      if (params.numResults) body.numResults = Number(params.numResults)
      if (params.type) body.type = params.type
      if (params.userLocation) body.userLocation = params.userLocation

      const includeDomains = parseCommaList(params.includeDomains)
      if (includeDomains) body.includeDomains = includeDomains
      const excludeDomains = parseCommaList(params.excludeDomains)
      if (excludeDomains) body.excludeDomains = excludeDomains

      const category = resolveCategory(params.category)
      if (category) body.category = category

      if (params.startPublishedDate) body.startPublishedDate = params.startPublishedDate
      if (params.endPublishedDate) body.endPublishedDate = params.endPublishedDate
      if (params.startCrawlDate) body.startCrawlDate = params.startCrawlDate
      if (params.endCrawlDate) body.endCrawlDate = params.endCrawlDate

      const outputSchema = parseJsonSchema(params.outputSchema, 'outputSchema')
      if (outputSchema) body.outputSchema = outputSchema
      if (params.systemPrompt) body.systemPrompt = params.systemPrompt

      /**
       * On `/search` the content options are nested under `contents` — unlike
       * `/contents`, where the same fields sit at the top level.
       */
      const contents: Record<string, any> = {}

      if (params.text !== undefined) contents.text = params.text
      if (params.highlights !== undefined) contents.highlights = params.highlights

      if (params.summaryQuery) {
        contents.summary = { query: params.summaryQuery }
      } else if (params.summary !== undefined) {
        contents.summary = params.summary
      }

      if (params.subpages) contents.subpages = Number(params.subpages)
      const subpageTarget = parseCommaList(params.subpageTarget)
      if (subpageTarget) contents.subpageTarget = subpageTarget

      const extras = buildExtras(params)
      if (extras) contents.extras = extras

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
        results: (data.results ?? []).map((result: any) => ({
          id: result.id,
          title: result.title || '',
          url: result.url,
          publishedDate: result.publishedDate,
          author: result.author,
          summary: result.summary,
          favicon: result.favicon,
          image: result.image,
          text: result.text,
          highlights: result.highlights,
          highlightScores: result.highlightScores,
          subpages: result.subpages,
          entities: result.entities,
          extras: result.extras,
          score: result.score,
        })),
        requestId: data.requestId,
        structuredOutput: data.output?.content,
        grounding: data.output?.grounding,
        __costDollars: data.costDollars,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Search results with titles, URLs, and text snippets',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Result identifier, usable as an id on the Get Contents operation',
          },
          title: { type: 'string', description: 'The title of the search result' },
          url: { type: 'string', description: 'The URL of the search result' },
          publishedDate: { type: 'string', description: 'Date when the content was published' },
          author: { type: 'string', description: 'The author of the content' },
          summary: { type: 'string', description: 'A brief summary of the content' },
          favicon: { type: 'string', description: "URL of the site's favicon" },
          image: { type: 'string', description: 'URL of a representative image from the page' },
          text: { type: 'string', description: 'Text snippet or full content from the page' },
          highlights: {
            type: 'array',
            description: 'Relevant snippets extracted from the page',
            items: { type: 'string' },
          },
          highlightScores: {
            type: 'array',
            description: 'Similarity score for each highlight',
            items: { type: 'number' },
          },
          subpages: { type: 'json', description: 'Crawled subpages of the result' },
          entities: {
            type: 'json',
            description: 'Structured entity data for company, people, and publication results',
          },
          extras: {
            type: 'json',
            description: 'Extracted links and image links when requested',
          },
          score: {
            type: 'number',
            description: 'Relevance score. Only returned by the legacy neural search type',
            optional: true,
          },
        },
      },
    },
    requestId: { type: 'string', description: 'Exa request identifier, useful for support' },
    structuredOutput: {
      type: 'json',
      description: 'Synthesized answer matching outputSchema, when one was supplied',
      optional: true,
    },
    grounding: {
      type: 'json',
      description: 'Field-level citations backing the synthesized output',
      optional: true,
    },
  },
}
