import type {
  ElasticsearchCountParams,
  ElasticsearchCountResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl, safeIndexPathSegment } from '@/tools/elasticsearch/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const countTool: ToolConfig<ElasticsearchCountParams, ElasticsearchCountResponse> = {
  id: 'elasticsearch_count',
  name: 'Elasticsearch Count',
  description: 'Count documents matching a query in Elasticsearch.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ELASTICSEARCH_ERRORS,

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
      return `${baseUrl}/${safeIndexPathSegment(params.index, 'index')}/_count`
    },
    method: 'POST',
    headers: (params) => buildAuthHeaders(params),
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
