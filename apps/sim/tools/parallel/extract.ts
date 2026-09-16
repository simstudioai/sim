import { toList } from '@/tools/parallel/search'
import type { ParallelExtractParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/**
 * Price of one extracted URL.
 *
 * Source: https://docs.parallel.ai/getting-started/pricing
 */
const URL_COST_USD = 0.001

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
        const urlCount = output.results.length
        const cost = urlCount * URL_COST_USD
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
      description: 'Comma-separated list of URLs to extract information from (up to 20)',
    },
    objective: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'What information to extract from the provided URLs (up to 5,000 characters)',
    },
    full_content: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include full page content as markdown in addition to excerpts (default: false)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Parallel AI API Key',
    },
  },

  request: {
    url: 'https://api.parallel.ai/v1/extract',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        urls: toList(params.urls),
      }

      if (params.objective) body.objective = params.objective
      if (params.full_content !== undefined) {
        body.advanced_settings = { full_content: params.full_content }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Parallel AI extract failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const extractId = data.extract_id ?? null
    const errors = Array.isArray(data.errors)
      ? data.errors.map((error: Record<string, unknown>) => ({
          url: error.url ?? null,
          error_type: error.error_type ?? null,
          http_status_code: error.http_status_code ?? null,
          content: error.content ?? null,
        }))
      : []

    if (!Array.isArray(data.results)) {
      return {
        success: false,
        error: 'No results returned from extraction',
        output: { extract_id: extractId, results: [], errors },
      }
    }

    if (data.results.length === 0 && errors.length > 0) {
      const summary = errors
        .map(
          (error: { url: string | null; error_type: string | null }) =>
            `${error.url ?? 'unknown url'} (${error.error_type ?? 'unknown error'})`
        )
        .join(', ')
      return {
        success: false,
        error: `Extraction failed for every URL: ${summary}`,
        output: { extract_id: extractId, results: [], errors },
      }
    }

    return {
      success: true,
      output: {
        extract_id: extractId,
        results: data.results.map((result: Record<string, unknown>) => ({
          url: result.url ?? null,
          title: result.title ?? null,
          publish_date: result.publish_date ?? null,
          excerpts: result.excerpts ?? [],
          full_content: result.full_content ?? null,
        })),
        errors,
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
          },
          full_content: {
            type: 'string',
            description: 'Full page content as markdown (only when requested)',
            optional: true,
          },
        },
      },
    },
    errors: {
      type: 'array',
      description: 'URLs that could not be extracted, with the reason',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL that failed' },
          error_type: { type: 'string', description: 'Category of the failure' },
          http_status_code: {
            type: 'number',
            description: 'HTTP status returned by the page, if any',
            optional: true,
          },
          content: { type: 'string', description: 'Error detail', optional: true },
        },
      },
    },
  },
}
