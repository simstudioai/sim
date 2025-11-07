import type { ExaGetContentsParams, ExaGetContentsResponse } from '@/tools/exa/types'
import type { ToolConfig } from '@/tools/types'

export const getContentsTool: ToolConfig<ExaGetContentsParams, ExaGetContentsResponse> = {
  id: 'exa_get_contents',
  name: 'Exa Get Contents',
  description:
    'Retrieve the contents of webpages using Exa AI. Returns the title, text content, and optional summaries for each URL.',
  version: '1.0.0',

  params: {
    urls: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of URLs to retrieve content from',
    },
    text: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'If true, returns full page text with default settings. If false, disables text return.',
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
      description: 'Number of subpages to crawl from the provided URLs',
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
    url: 'https://api.exa.ai/contents',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      // Parse the comma-separated URLs into an array
      const urlsString = params.urls
      const urlArray = urlsString
        .split(',')
        .map((url: string) => url.trim())
        .filter((url: string) => url.length > 0)

      const body: Record<string, any> = {
        urls: urlArray,
      }

      // Add optional parameters if provided
      if (params.text !== undefined) {
        body.text = params.text
      }

      // Add summary with query if provided
      if (params.summaryQuery) {
        body.summary = {
          query: params.summaryQuery,
        }
      }

      // Subpages crawling
      if (params.subpages !== undefined) {
        body.subpages = Number(params.subpages)
      }

      if (params.subpageTarget) {
        body.subpageTarget = params.subpageTarget
          .split(',')
          .map((target: string) => target.trim())
          .filter((target: string) => target.length > 0)
      }

      // Content options
      if (params.highlights !== undefined) {
        body.highlights = params.highlights
      }

      // Live crawl mode
      if (params.livecrawl) {
        body.livecrawl = params.livecrawl
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
          url: result.url,
          title: result.title || '',
          text: result.text || '',
          summary: result.summary || '',
          highlights: result.highlights,
        })),
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
          url: { type: 'string', description: 'The URL that content was retrieved from' },
          title: { type: 'string', description: 'The title of the webpage' },
          text: { type: 'string', description: 'The full text content of the webpage' },
          summary: { type: 'string', description: 'AI-generated summary of the webpage content' },
        },
      },
    },
  },
}
