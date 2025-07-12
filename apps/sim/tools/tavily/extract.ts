import type { ToolConfig } from '../types'
import type { TavilyExtractParams, TavilyExtractResponse } from './types'

export const extractTool: ToolConfig<TavilyExtractParams, TavilyExtractResponse> = {
  id: 'tavily_extract',
  name: 'Tavily Extract',
  description:
    "Extract raw content from multiple web pages simultaneously using Tavily's extraction API. Supports basic and advanced extraction depths with detailed error reporting for failed URLs.",
  version: '1.0.0',

  params: {
    urls: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL or array of URLs to extract content from',
    },
    extract_depth: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The depth of extraction (basic=1 credit/5 URLs, advanced=2 credits/5 URLs)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tavily API Key',
    },
  },

  request: {
    url: 'https://api.tavily.com/extract',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        urls: typeof params.urls === 'string' ? [params.urls] : params.urls,
      }

      if (params.extract_depth) body.extract_depth = params.extract_depth

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Failed to extract content')
    }

    return {
      success: true,
      output: {
        results: data.results || [],
        ...(data.failed_results && { failed_results: data.failed_results }),
        response_time: data.response_time,
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'An error occurred while extracting content'
  },
}
