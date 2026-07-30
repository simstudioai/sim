import type { ExaGetContentsParams, ExaGetContentsResponse } from '@/tools/exa/types'
import { applyFreshness, buildExtras, parseCommaList, requireCostTotal } from '@/tools/exa/utils'
import type { ToolConfig } from '@/tools/types'

export const getContentsTool: ToolConfig<ExaGetContentsParams, ExaGetContentsResponse> = {
  id: 'exa_get_contents',
  name: 'Exa Get Contents',
  description:
    'Retrieve the contents of webpages using Exa AI. Returns the title, text content, and optional summaries for each URL.',
  version: '2.0.0',

  params: {
    urls: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of URLs to retrieve content from (1-100). Provide either urls or ids, not both.',
    },
    ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of result IDs from a prior Exa search (1-100). Provide either urls or ids, not both.',
    },
    text: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'If true, returns full page text with default settings. If false, disables text return.',
    },
    summary: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include an AI-generated summary of each page (default: false)',
    },
    summaryQuery: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Query to guide the summary generation',
    },
    subpages: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of subpages to crawl from the provided URLs (0-100)',
    },
    subpageTarget: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Comma-separated keywords to target specific subpages (e.g., "docs,tutorial,about")',
    },
    highlights: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include highlighted snippets in results (default: false)',
    },
    extrasLinks: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of links to extract from each page (0-1000). Default: 0',
    },
    extrasImageLinks: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of image URLs to extract from each page (0-1000). Default: 0',
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
        const cost = requireCostTotal(output, 'get_contents')
        return { cost, metadata: { costDollars: output.__costDollars } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 10,
    },
  },

  request: {
    url: 'https://api.exa.ai/contents',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const urls = parseCommaList(params.urls)
      const ids = parseCommaList(params.ids)

      /** Exa rejects a request carrying both selectors with a 400. */
      if (urls && ids) {
        throw new Error('Provide either urls or ids for Exa Get Contents, not both')
      }
      if (!urls && !ids) {
        throw new Error('Exa Get Contents requires either urls or ids')
      }

      const body: Record<string, any> = urls ? { urls } : { ids }

      if (params.text !== undefined) body.text = params.text

      if (params.summaryQuery) {
        body.summary = { query: params.summaryQuery }
      } else if (params.summary !== undefined) {
        body.summary = params.summary
      }

      if (params.subpages !== undefined) body.subpages = Number(params.subpages)
      const subpageTarget = parseCommaList(params.subpageTarget)
      if (subpageTarget) body.subpageTarget = subpageTarget

      if (params.highlights !== undefined) body.highlights = params.highlights

      const extras = buildExtras(params)
      if (extras) body.extras = extras

      applyFreshness(body, params)

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
          url: result.url,
          title: result.title || '',
          text: result.text || '',
          summary: result.summary || '',
          highlights: result.highlights,
          highlightScores: result.highlightScores,
          subpages: result.subpages,
          entities: result.entities,
          extras: result.extras,
        })),
        statuses: data.statuses,
        requestId: data.requestId,
        __costDollars: data.costDollars,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Retrieved content from URLs with title, text, and summaries',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exa identifier for the retrieved document' },
          url: { type: 'string', description: 'The URL that content was retrieved from' },
          title: { type: 'string', description: 'The title of the webpage' },
          text: { type: 'string', description: 'The full text content of the webpage' },
          summary: { type: 'string', description: 'AI-generated summary of the webpage content' },
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
          subpages: { type: 'json', description: 'Crawled subpages of the document' },
          entities: {
            type: 'json',
            description: 'Structured entity data for company, people, and publication pages',
          },
          extras: { type: 'json', description: 'Extracted links and image links when requested' },
        },
      },
    },
    statuses: {
      type: 'json',
      description:
        'Per-URL crawl outcome, showing which pages succeeded and whether they came from cache',
    },
    requestId: { type: 'string', description: 'Exa request identifier, useful for support' },
  },
}
