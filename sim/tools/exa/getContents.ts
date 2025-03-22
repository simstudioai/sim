import { ToolConfig } from '../types'
import { ExaGetContentsParams, ExaGetContentsResponse } from './types'

export const getContentsTool: ToolConfig<ExaGetContentsParams, ExaGetContentsResponse> = {
  id: 'exa_get_contents',
  name: 'Exa Get Contents',
  description:
    'Retrieve the contents of webpages using Exa AI. Returns the title, text content, and optional summaries for each URL.',
  version: '1.0.0',

  params: {
    urls: {
      type: 'string[]',
      required: true,
      description: 'Array of URLs to retrieve content from',
    },
    text: {
      type: 'boolean',
      required: false,
      description:
        'If true, returns full page text with default settings. If false, disables text return.',
    },
    summaryQuery: {
      type: 'string',
      required: false,
      description: 'Query to guide the summary generation',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Exa AI API Key',
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
      const body: Record<string, any> = {
        urls: params.urls,
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
