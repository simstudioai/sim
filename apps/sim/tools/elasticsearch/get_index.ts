import type {
  ElasticsearchGetIndexParams,
  ElasticsearchIndexInfoResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getIndexTool: ToolConfig<ElasticsearchGetIndexParams, ElasticsearchIndexInfoResponse> =
  {
    id: 'elasticsearch_get_index',
    name: 'Elasticsearch Get Index',
    description: 'Retrieve index information including settings, mappings, and aliases.',
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
        description: 'Index name to retrieve info for (e.g., "products", "logs-2024")',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = buildBaseUrl(params)
        return `${baseUrl}/${safeUrlPathSegment(params.index, 'index')}`
      },
      method: 'GET',
      headers: (params) => buildAuthHeaders(params),
    },

    transformResponse: async (response: Response) => {
      const data = (await response.json()) as Record<
        string,
        {
          aliases?: Record<string, unknown>
          mappings?: Record<string, unknown>
          settings?: Record<string, unknown>
        }
      >

      const [indexName] = Object.keys(data)
      const info = indexName ? data[indexName] : undefined

      return {
        success: true,
        output: {
          index: indexName ?? '',
          aliases: info?.aliases ?? {},
          mappings: info?.mappings ?? {},
          settings: info?.settings ?? {},
        },
      }
    },

    outputs: {
      index: {
        type: 'string',
        description: 'Resolved index name the information belongs to',
      },
      aliases: {
        type: 'json',
        description: 'Aliases defined on the index',
      },
      mappings: {
        type: 'json',
        description: 'Field mappings for the index',
      },
      settings: {
        type: 'json',
        description: 'Index settings',
      },
    },
  }
