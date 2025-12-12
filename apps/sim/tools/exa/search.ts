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
      visibility: 'user-only',
      description: 'Number of results to return (default: 10, max: 25)',
    },
    useAutoprompt: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to use autoprompt to improve the query (default: false)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search type: neural, keyword, auto or fast (default: auto)',
    },
    includeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to include in results',
    },
    excludeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to exclude from results',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Filter by category: company, research_paper, news_article, pdf, github, tweet, movie, song, personal_site',
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
      description: 'Live crawling mode: always, fallback, or never (default: never)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
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

      // Add optional parameters if provided
      if (params.numResults) body.numResults = Number(params.numResults)
      if (params.useAutoprompt !== undefined) body.useAutoprompt = params.useAutoprompt
      if (params.type) body.type = params.type

      // Domain filtering
      if (params.includeDomains) {
        body.includeDomains = params.includeDomains
          .split(',')
          .map((d: string) => d.trim())
          .filter((d: string) => d.length > 0)
      }
      if (params.excludeDomains) {
        body.excludeDomains = params.excludeDomains
          .split(',')
          .map((d: string) => d.trim())
          .filter((d: string) => d.length > 0)
      }

      // Category filtering
      if (params.category) body.category = params.category

      // Build contents object for content options
      const contents: Record<string, any> = {}

      if (params.text !== undefined) {
        contents.text = params.text
      }

      if (params.highlights !== undefined) {
        contents.highlights = params.highlights
      }

      if (params.summary !== undefined) {
        contents.summary = params.summary
      }

      if (params.livecrawl) {
        contents.livecrawl = params.livecrawl
      }

      // Add contents to body if not empty
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
