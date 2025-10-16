import type { AirweaveSearchParams, AirweaveSearchResponse } from '@/tools/airweave/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<AirweaveSearchParams, AirweaveSearchResponse> = {
  id: 'airweave_search',
  name: 'Airweave Search',
  description:
    'Search across all connected data sources in your Airweave collection. Supports 50+ integrations including Stripe, GitHub, Notion, Slack, HubSpot, Zendesk, and more. Returns relevant search results with metadata or AI-generated summaries.',
  version: '1.0.0',

  params: {
    collectionId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The readable ID of the Airweave collection to search',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to find relevant information from connected data sources',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (1-100, default: 10)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to skip for pagination (default: 0)',
    },
    responseType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "Response format: 'raw' for search results or 'completion' for AI-generated answer (default: 'raw')",
    },
    recencyBias: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Weight for recent results (0.0=no bias, 1.0=only recency, default: 0.0)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Airweave API Key (get from https://app.airweave.ai)',
    },
  },

  request: {
    url: (params) => `https://api.airweave.ai/v1/collections/${params.collectionId}/search`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
        limit: params.limit || 10,
        offset: params.offset || 0,
      }

      if (params.responseType) {
        body.response_type = params.responseType
      }

      if (params.recencyBias !== undefined) {
        body.recency_bias = params.recencyBias
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        status: data.status || 'success',
        results: data.results || [],
        completion: data.completion,
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Status of the search operation (success, no_results, no_relevant_results)',
    },
    results: {
      type: 'array',
      description: 'Search results with content and metadata from connected data sources',
      items: {
        type: 'object',
        properties: {
          payload: {
            type: 'object',
            properties: {
              md_content: { type: 'string', description: 'Markdown content of the result' },
              source_name: { type: 'string', description: 'Name of the data source' },
              entity_id: { type: 'string', description: 'Unique identifier of the entity' },
              created_at: { type: 'string', description: 'Creation timestamp' },
              url: { type: 'string', description: 'URL of the source' },
            },
          },
          score: {
            type: 'number',
            description: 'Relevance score for the search result',
          },
        },
      },
    },
    completion: {
      type: 'string',
      optional: true,
      description: 'AI-generated answer (when response_type is completion)',
    },
  },
}

