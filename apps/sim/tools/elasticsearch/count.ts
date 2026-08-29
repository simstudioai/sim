import type {
  ElasticsearchCountParams,
  ElasticsearchCountResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'

export const countTool: ToolConfig<ElasticsearchCountParams, ElasticsearchCountResponse> = {
  id: 'elasticsearch_count',
  name: 'Elasticsearch Count',
  description: 'Count documents matching a query in Elasticsearch.',
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
      description: 'Index name to count documents in (e.g., "products", "logs-2024")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Query DSL to filter documents (JSON string). Example: {"match":{"status":"active"}}',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      return `${baseUrl}/${encodeURIComponent(params.index)}/_count`
    },
    method: 'POST',
    headers: (params) => buildAuthHeaders(params),
    /**
     * `host` is a user-supplied origin, so a redirect to a *different* origin
     * must not carry the API key or Basic credentials with it. Credentials are
     * kept on a same-origin hop: a reverse proxy in front of Elasticsearch can
     * legitimately redirect within its own origin, and dropping the header
     * there would turn a valid request into a 401.
     *
     * `mode: 'legacy'` preserves the existing method and body replay semantics,
     * so the only behavior change is the cross-origin credential strip. Under
     * `'standard'` a 301/302 would rewrite POST to GET, breaking the `_search`,
     * `_count` and `_bulk` calls.
     */
    redirectPolicy: () => ({ mode: 'legacy', sendCredentialsOnCrossOriginRedirect: false }),
    body: (params) => {
      if (params.query) {
        try {
          return { query: JSON.parse(params.query) }
        } catch {
          throw new Error('Invalid JSON provided for query')
        }
      }
      return {}
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
          count: 0,
          _shards: { total: 0, successful: 0, skipped: 0, failed: 0 },
        },
        error: errorMessage,
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        count: data.count,
        _shards: data._shards,
      },
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Number of documents matching the query',
    },
    _shards: {
      type: 'object',
      description: 'Shard statistics',
    },
  },
}
