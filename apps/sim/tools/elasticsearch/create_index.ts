import type {
  ElasticsearchCreateIndexParams,
  ElasticsearchIndexResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const createIndexTool: ToolConfig<
  ElasticsearchCreateIndexParams,
  ElasticsearchIndexResponse
> = {
  id: 'elasticsearch_create_index',
  name: 'Elasticsearch Create Index',
  description: 'Create a new index with optional settings and mappings.',
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
      description: 'Index name to create (e.g., "products", "logs-2024")',
    },
    settings: {
      type: 'string',
      required: false,
      description: 'Index settings as JSON string',
    },
    mappings: {
      type: 'string',
      required: false,
      description: 'Index mappings as JSON string',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      return `${baseUrl}/${safeUrlPathSegment(params.index, 'index')}`
    },
    method: 'PUT',
    headers: (params) => buildAuthHeaders(params),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.settings) {
        try {
          body.settings = JSON.parse(params.settings)
        } catch {
          throw new Error('Invalid JSON provided for settings')
        }
      }

      if (params.mappings) {
        try {
          body.mappings = JSON.parse(params.mappings)
        } catch {
          throw new Error('Invalid JSON provided for mappings')
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        acknowledged: data.acknowledged,
        shards_acknowledged: data.shards_acknowledged,
        index: data.index,
      },
    }
  },

  outputs: {
    acknowledged: {
      type: 'boolean',
      description: 'Whether the request was acknowledged',
    },
    shards_acknowledged: {
      type: 'boolean',
      description: 'Whether the shards were acknowledged',
    },
    index: {
      type: 'string',
      description: 'Created index name',
    },
  },
}
