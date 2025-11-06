import type { ExaFindSimilarLinksParams, ExaFindSimilarLinksResponse } from '@/tools/exa/types'
import type { ToolConfig } from '@/tools/types'

export const findSimilarLinksTool: ToolConfig<
  ExaFindSimilarLinksParams,
  ExaFindSimilarLinksResponse
> = {
  id: 'exa_find_similar_links',
  name: 'Exa Find Similar Links',
  description:
    'Find webpages similar to a given URL using Exa AI. Returns a list of similar links with titles and text snippets.',
  version: '1.0.0',

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
      visibility: 'user-only',
      description: 'Number of similar links to return (default: 10, max: 25)',
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
      visibility: 'user-only',
      description: 'Comma-separated list of domains to include in results',
    },
    excludeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to exclude from results',
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
        'Filter by category: company, research_paper, news_article, pdf, github, tweet, movie, song, personal_site',
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

      // Add optional parameters if provided
      if (params.numResults) body.numResults = Number(params.numResults)

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
      if (params.excludeSourceDomain !== undefined) {
        body.excludeSourceDomain = params.excludeSourceDomain
      }

      // Category filtering
      if (params.category) body.category = params.category

      // Content options - build contents object
      const contents: Record<string, any> = {}
      if (params.text !== undefined) contents.text = params.text
      if (params.highlights !== undefined) contents.highlights = params.highlights
      if (params.summary !== undefined) contents.summary = params.summary

      // Live crawl mode should be inside contents
      if (params.livecrawl) contents.livecrawl = params.livecrawl

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
        similarLinks: data.results.map((result: any) => ({
          title: result.title || '',
          url: result.url,
          text: result.text || '',
          summary: result.summary,
          highlights: result.highlights,
          score: result.score || 0,
        })),
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
          title: { type: 'string', description: 'The title of the similar webpage' },
          url: { type: 'string', description: 'The URL of the similar webpage' },
          text: {
            type: 'string',
            description: 'Text snippet or full content from the similar webpage',
          },
          score: {
            type: 'number',
            description: 'Similarity score indicating how similar the page is',
          },
        },
      },
    },
  },
}
