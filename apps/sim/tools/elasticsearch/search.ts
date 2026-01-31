import type {
  ElasticsearchSearchParams,
  ElasticsearchSearchResponse,
} from '@/tools/elasticsearch/types'
import type { ToolConfig } from '@/tools/types'

// Helper to build base URL from connection params
function buildBaseUrl(params: ElasticsearchSearchParams): string {
  if (params.deploymentType === 'cloud' && params.cloudId) {
    // Parse Cloud ID: format is "name:base64data"
    // The base64 data contains: es_host$kibana_host ($ separated)
    const parts = params.cloudId.split(':')
    if (parts.length >= 2) {
      try {
        const decoded = Buffer.from(parts[1], 'base64').toString('utf-8')
        const [esHost] = decoded.split('$')
        if (esHost) {
          // Cloud endpoints are always HTTPS with port 443
          return `https://${parts[0]}.${esHost}`
        }
      } catch {
        // If decoding fails, try using cloudId directly as host
      }
    }
    throw new Error('Invalid Cloud ID format')
  }

  if (!params.host) {
    throw new Error('Host is required for self-hosted deployments')
  }

  return params.host.replace(/\/$/, '') // Remove trailing slash
}

// Helper to build auth headers
function buildAuthHeaders(params: ElasticsearchSearchParams): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (params.authMethod === 'api_key' && params.apiKey) {
    headers.Authorization = `ApiKey ${params.apiKey}`
  } else if (params.authMethod === 'basic_auth' && params.username && params.password) {
    const credentials = Buffer.from(`${params.username}:${params.password}`).toString('base64')
    headers.Authorization = `Basic ${credentials}`
  } else {
    throw new Error('Invalid authentication configuration')
  }

  return headers
}

export const searchTool: ToolConfig<ElasticsearchSearchParams, ElasticsearchSearchResponse> = {
  id: 'elasticsearch_search',
  name: 'Elasticsearch Search',
  description:
    'Search documents in Elasticsearch using Query DSL. Returns matching documents with scores and metadata.',
  version: '1.0.0',

  params: {
    deploymentType: {
      type: 'string',
      required: true,
      description: 'Deployment type: self_hosted or cloud',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Elasticsearch host URL (for self-hosted)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Elastic Cloud ID (for cloud deployments)',
    },
    authMethod: {
      type: 'string',
      required: true,
      description: 'Authentication method: api_key or basic_auth',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Elasticsearch API key',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username for basic auth',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for basic auth',
    },
    index: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Index name to search (e.g., "products", "logs-2024")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Query DSL as JSON string. Example: {"match":{"title":"search term"}} or {"bool":{"must":[...]}}',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Starting offset for pagination (e.g., 0, 10, 20). Default: 0',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (e.g., 10, 25, 100). Default: 10',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort specification as JSON string. Example: [{"created_at":"desc"}] or [{"_score":"desc"},{"name":"asc"}]',
    },
    sourceIncludes: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of fields to include in _source',
    },
    sourceExcludes: {
      type: 'string',
      required: false,
      description: 'Comma-separated list of fields to exclude from _source',
    },
    trackTotalHits: {
      type: 'boolean',
      required: false,
      description: 'Track accurate total hit count (default: true)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      return `${baseUrl}/${encodeURIComponent(params.index)}/_search`
    },
    method: 'POST',
    headers: (params) => buildAuthHeaders(params),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.query) {
        try {
          body.query = JSON.parse(params.query)
        } catch {
          // If not valid JSON, treat as simple match query
          body.query = { match_all: {} }
        }
      }

      if (params.from !== undefined) body.from = params.from
      if (params.size !== undefined) body.size = params.size

      if (params.sort) {
        try {
          body.sort = JSON.parse(params.sort)
        } catch {
          // Ignore invalid sort
        }
      }

      if (params.sourceIncludes || params.sourceExcludes) {
        body._source = {}
        if (params.sourceIncludes) {
          ;(body._source as Record<string, unknown>).includes = params.sourceIncludes
            .split(',')
            .map((s) => s.trim())
        }
        if (params.sourceExcludes) {
          ;(body._source as Record<string, unknown>).excludes = params.sourceExcludes
            .split(',')
            .map((s) => s.trim())
        }
      }

      if (params.trackTotalHits !== undefined) {
        body.track_total_hits = params.trackTotalHits
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `Elasticsearch error: ${response.status}`
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error?.reason || errorJson.error?.type || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      return {
        success: false,
        output: {
          took: 0,
          timed_out: false,
          hits: { total: { value: 0, relation: 'eq' }, max_score: null, hits: [] },
        },
        error: errorMessage,
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        took: data.took,
        timed_out: data.timed_out,
        hits: {
          total: data.hits.total,
          max_score: data.hits.max_score,
          hits: data.hits.hits.map((hit: Record<string, unknown>) => ({
            _index: hit._index,
            _id: hit._id,
            _score: hit._score,
            _source: hit._source,
          })),
        },
        aggregations: data.aggregations,
      },
    }
  },

  outputs: {
    took: {
      type: 'number',
      description: 'Time in milliseconds the search took',
    },
    timed_out: {
      type: 'boolean',
      description: 'Whether the search timed out',
    },
    hits: {
      type: 'object',
      description: 'Search results with total count and matching documents',
    },
    aggregations: {
      type: 'json',
      description: 'Aggregation results if any',
      optional: true,
    },
  },
}
