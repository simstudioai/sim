import type { ParallelExtractParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const extractTool: ToolConfig<ParallelExtractParams, ToolResponse> = {
  id: 'parallel_extract',
  name: 'Parallel AI Extract',
  description:
    'Extract targeted information from specific URLs using Parallel AI. Processes provided URLs to pull relevant content based on your objective.',
  version: '1.0.0',

  params: {
    urls: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of URLs to extract information from',
    },
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'What information to extract from the provided URLs',
    },
    excerpts: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Include relevant excerpts from the content',
    },
    full_content: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Include full page content',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Parallel AI API Key',
    },
  },

  request: {
    url: 'https://api.parallel.ai/v1beta/extract',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'parallel-beta': 'search-extract-2025-10-10',
    }),
    body: (params) => {
      // Convert comma-separated URLs to array
      const urlArray = params.urls
        .split(',')
        .map((url) => url.trim())
        .filter((url) => url.length > 0)

      const body: Record<string, unknown> = {
        urls: urlArray,
        objective: params.objective,
      }

      // Add optional parameters if provided
      if (params.excerpts !== undefined) body.excerpts = params.excerpts
      if (params.full_content !== undefined) body.full_content = params.full_content

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        results: data.results || [],
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Extracted information from the provided URLs',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The source URL' },
          title: { type: 'string', description: 'The title of the page' },
          content: { type: 'string', description: 'Extracted content' },
          excerpts: {
            type: 'array',
            description: 'Relevant text excerpts',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}
