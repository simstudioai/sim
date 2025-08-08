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
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
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

  request: {
    url: 'https://api.exa.ai/contents',
    method: 'POST',
    isInternalRoute: false,
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

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to retrieve webpage contents')
    }

    return {
      success: true,
      output: {
        results: data.results.map((result: any) => ({
          url: result.url,
          title: result.title || '',
          text: result.text || '',
          summary: result.summary || '',
        })),
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error
      ? error.message
      : 'An error occurred while retrieving webpage contents'
  },
}
