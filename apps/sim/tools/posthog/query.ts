import type { ToolConfig } from '@/tools/types'

export interface PostHogQueryParams {
  personalApiKey: string
  region?: 'us' | 'eu'
  projectId: string
  query: string
  values?: string
}

export interface PostHogQueryResponse {
  success: boolean
  output: {
    results: any[]
    columns?: string[]
    types?: string[]
    hogql?: string
    has_more?: boolean
  }
}

export const queryTool: ToolConfig<PostHogQueryParams, PostHogQueryResponse> = {
  id: 'posthog_query',
  name: 'PostHog Query',
  description:
    "Execute a HogQL query in PostHog. HogQL is PostHog's SQL-like query language for analytics. Use this for advanced data retrieval and analysis.",
  version: '1.0.0',

  params: {
    personalApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Personal API Key (for authenticated API access)',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog region: us (default) or eu',
      default: 'us',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostHog Project ID (e.g., "12345" or project UUID)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'HogQL query to execute. Example: {"kind": "HogQLQuery", "query": "SELECT event, count() FROM events WHERE timestamp > now() - INTERVAL 1 DAY GROUP BY event"}',
    },
    values: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional JSON string of parameter values for parameterized queries. Example: {"user_id": "123"}',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/query/`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.personalApiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let query: any
      try {
        query = JSON.parse(params.query)
      } catch (e) {
        // If it's not valid JSON, treat it as a raw HogQL string
        query = {
          kind: 'HogQLQuery',
          query: params.query,
        }
      }

      const body: Record<string, any> = {
        query: query,
      }

      if (params.values) {
        try {
          body.values = JSON.parse(params.values)
        } catch (e) {
          // Ignore invalid values JSON
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text()
      return {
        success: false,
        output: {
          results: [],
        },
        error: error || 'Failed to execute query',
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        results: data.results || [],
        columns: data.columns || undefined,
        types: data.types || undefined,
        hogql: data.hogql || undefined,
        has_more: data.hasMore || false,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Query results as an array of rows',
      items: {
        type: 'object',
        properties: {},
      },
    },
    columns: {
      type: 'array',
      description: 'Column names in the result set',
      optional: true,
      items: {
        type: 'string',
      },
    },
    types: {
      type: 'array',
      description: 'Data types of columns in the result set',
      optional: true,
      items: {
        type: 'string',
      },
    },
    hogql: {
      type: 'string',
      description: 'The actual HogQL query that was executed',
      optional: true,
    },
    has_more: {
      type: 'boolean',
      description: 'Whether there are more results available',
      optional: true,
    },
  },
}
