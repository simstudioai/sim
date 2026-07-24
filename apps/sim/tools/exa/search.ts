import { buildExaSearchBody } from '@/tools/exa/search-client'
import type { ExaSearchParams, ExaSearchResponse } from '@/tools/exa/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<ExaSearchParams, ExaSearchResponse> = {
  id: 'exa_search',
  name: 'Exa Search',
  description:
    'Search the web using Exa AI. Returns relevant search results with titles, URLs, and text snippets.',
  version: '1.0.0',

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
      description: 'Number of results to return (e.g., 5, 10, 25). Default: 10, max: 25',
    },
    useAutoprompt: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to use autoprompt to improve the query (true or false). Default: false',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search type: "neural", "keyword", "auto", or "fast". Default: "auto"',
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
        'Filter by category: company, research paper, news, pdf, github, tweet, personal site, linkedin profile, financial report',
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
    livecrawl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Live crawling mode: never (default), fallback, always, or preferred (always try livecrawl, fall back to cache if fails)',
    },
    startCrawlDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only include results crawled on or after this ISO 8601 date (e.g., "2024-01-01" or "2024-01-01T00:00:00.000Z")',
    },
    endCrawlDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include results crawled on or before this ISO 8601 date',
    },
    startPublishedDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include results published on or after this ISO 8601 date',
    },
    endPublishedDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include results published on or before this ISO 8601 date',
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
        const costDollars = output.__costDollars as { total?: number } | undefined
        if (costDollars?.total == null) {
          throw new Error('Exa search response missing costDollars field')
        }
        return { cost: costDollars.total, metadata: { costDollars } }
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
    body: buildExaSearchBody,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        results: data.results.map((result: any) => ({
          title: result.title || '',
          url: result.url,
          publishedDate: result.publishedDate,
          author: result.author,
          summary: result.summary,
          favicon: result.favicon,
          image: result.image,
          text: result.text,
          highlights: result.highlights,
          score: result.score,
        })),
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
          title: { type: 'string', description: 'The title of the search result' },
          url: { type: 'string', description: 'The URL of the search result' },
          publishedDate: { type: 'string', description: 'Date when the content was published' },
          author: { type: 'string', description: 'The author of the content' },
          summary: { type: 'string', description: 'A brief summary of the content' },
          favicon: { type: 'string', description: "URL of the site's favicon" },
          image: { type: 'string', description: 'URL of a representative image from the page' },
          text: { type: 'string', description: 'Text snippet or full content from the page' },
          score: { type: 'number', description: 'Relevance score for the search result' },
        },
      },
    },
  },
}
