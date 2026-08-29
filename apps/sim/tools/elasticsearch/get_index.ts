import type {
  ElasticsearchGetIndexParams,
  ElasticsearchIndexInfoResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'

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
        return `${baseUrl}/${encodeURIComponent(params.index)}`
      },
      method: 'GET',
      headers: (params) => buildAuthHeaders(params),
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
          output: { indices: {} },
          error: errorMessage,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: { indices: data },
      }
    },

    outputs: {
      indices: {
        type: 'json',
        description:
          'Matched indices keyed by index name, each with its aliases, mappings, and settings',
      },
    },
  }
