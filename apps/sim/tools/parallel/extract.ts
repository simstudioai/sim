import type { ParallelExtractParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const extractTool: ToolConfig<ParallelExtractParams, ToolResponse> = {
  id: 'parallel_extract',
  name: 'Parallel AI Extract',
  description:
    'Extract targeted information from specific URLs using Parallel AI. Processes provided URLs to pull relevant content based on your objective.',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'PARALLEL_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'parallel_ai',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        if (!Array.isArray(output.results)) {
          throw new Error('Parallel extract response missing results array')
        }
        // Parallel Extract: $1 per 1,000 URLs = $0.001 per URL
        // https://docs.parallel.ai/resources/pricing
        const urlCount = output.results.length
        const cost = urlCount * 0.001
        return { cost, metadata: { urlCount } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 30,
    },
  },

  params: {
    urls: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of URLs to extract information from',
    },
    objective: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'What information to extract from the provided URLs',
    },
    excerpts: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include relevant excerpts from the content (default: true)',
    },
    full_content: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include full page content as markdown (default: false)',
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
      const urlArray = params.urls
        .split(',')
        .map((url) => url.trim())
        .filter((url) => url.length > 0)

      const body: Record<string, unknown> = {
        urls: urlArray,
      }

      if (params.objective) body.objective = params.objective
      if (params.excerpts !== undefined) body.excerpts = params.excerpts
      if (params.full_content !== undefined) body.full_content = params.full_content

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Parallel AI extract failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    if (!data.results) {
      return {
        success: false,
        error: 'No results returned from extraction',
        output: {
          results: [],
          extract_id: data.extract_id ?? null,
        },
      }
    }

    return {
      success: true,
      output: {
        extract_id: data.extract_id ?? null,
        results: data.results.map((result: Record<string, unknown>) => ({
          url: result.url ?? null,
          title: result.title ?? null,
          publish_date: result.publish_date ?? null,
          excerpts: result.excerpts ?? [],
          full_content: result.full_content ?? null,
        })),
      },
    }
  },

  outputs: {
    extract_id: {
      type: 'string',
      description: 'Unique identifier for this extraction request',
    },
    results: {
      type: 'array',
      description: 'Extracted information from the provided URLs',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The source URL' },
          title: { type: 'string', description: 'The title of the page', optional: true },
          publish_date: {
            type: 'string',
            description: 'Publication date (YYYY-MM-DD)',
            optional: true,
          },
          excerpts: {
            type: 'array',
            description: 'Relevant text excerpts in markdown',
            items: { type: 'string' },
            optional: true,
          },
          full_content: {
            type: 'string',
            description: 'Full page content as markdown',
            optional: true,
          },
        },
      },
    },
  },
}
