import type { BrightDataDiscoverParams, BrightDataDiscoverResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

export const brightDataDiscoverTool: ToolConfig<
  BrightDataDiscoverParams,
  BrightDataDiscoverResponse
> = {
  id: 'brightdata_discover',
  name: 'Bright Data Discover',
  description:
    'AI-powered web discovery that finds and ranks results by intent. Returns up to 1,000 results with optional cleaned page content for RAG and verification.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query (e.g., "competitor pricing changes enterprise plan")',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return, up to 1000. Defaults to 10',
    },
    intent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Describes what the agent is trying to accomplish, used to rank results by relevance (e.g., "find official pricing pages and change notes")',
    },
    includeContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include cleaned page content in results',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Response format: "json" or "markdown". Defaults to "json"',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search language code (e.g., "en", "es", "fr"). Defaults to "en"',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter ISO country code for localized results (e.g., "us", "gb")',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.brightdata.com/discover',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        query: params.query,
      }
      if (params.numResults) body.num_results = params.numResults
      if (params.intent) body.intent = params.intent
      if (params.includeContent != null) body.include_content = params.includeContent
      if (params.format) body.format = params.format
      if (params.language) body.language = params.language
      if (params.country) body.country = params.country
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Discover request failed with status ${response.status}`)
    }

    const data = await response.json()

    let results: Array<{
      url: string | null
      title: string | null
      description: string | null
      relevanceScore: number | null
      content: string | null
    }> = []

    const items = Array.isArray(data) ? data : (data?.results ?? data?.data ?? [])

    if (Array.isArray(items)) {
      results = items.map((item: Record<string, unknown>) => ({
        url: (item.link as string) ?? (item.url as string) ?? null,
        title: (item.title as string) ?? null,
        description: (item.description as string) ?? (item.snippet as string) ?? null,
        relevanceScore: (item.relevance_score as number) ?? null,
        content:
          (item.content as string) ?? (item.text as string) ?? (item.markdown as string) ?? null,
      }))
    }

    return {
      success: true,
      output: {
        results,
        query: null,
        totalResults: results.length,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of discovered web results ranked by intent relevance',
      items: {
        type: 'object',
        description: 'A discovered result',
        properties: {
          url: { type: 'string', description: 'URL of the discovered page', optional: true },
          title: { type: 'string', description: 'Page title', optional: true },
          description: {
            type: 'string',
            description: 'Page description or snippet',
            optional: true,
          },
          relevanceScore: {
            type: 'number',
            description: 'AI-calculated relevance score for intent-based ranking',
            optional: true,
          },
          content: {
            type: 'string',
            description:
              'Cleaned page content in the requested format (when includeContent is true)',
            optional: true,
          },
        },
      },
    },
    query: { type: 'string', description: 'The search query that was executed', optional: true },
    totalResults: { type: 'number', description: 'Total number of results returned' },
  },
}
