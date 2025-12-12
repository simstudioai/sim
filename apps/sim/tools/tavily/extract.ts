import type { TavilyExtractParams, TavilyExtractResponse } from '@/tools/tavily/types'
import type { ToolConfig } from '@/tools/types'

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
    format: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Output format: markdown or text (default: markdown)',
    },
    include_images: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Incorporate images in extraction output',
    },
    include_favicon: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Add favicon URL for each result',
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
      if (params.format) body.format = params.format
      if (params.include_images !== undefined) body.include_images = params.include_images
      if (params.include_favicon !== undefined) body.include_favicon = params.include_favicon

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        results: data.results || [],
        ...(data.failed_results && { failed_results: data.failed_results }),
        response_time: data.response_time,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL that was extracted' },
          raw_content: { type: 'string', description: 'The raw text content from the webpage' },
          favicon: { type: 'string', description: 'Favicon URL (if requested)' },
        },
      },
      description: 'Successfully extracted content from URLs',
    },
    failed_results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL that failed extraction' },
          error: { type: 'string', description: 'Error message for the failed extraction' },
        },
      },
      description: 'URLs that failed to extract content',
    },
    response_time: {
      type: 'number',
      description: 'Time taken for the extraction request in seconds',
    },
  },
}
