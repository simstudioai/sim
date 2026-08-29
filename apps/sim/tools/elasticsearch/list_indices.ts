import type {
  ElasticsearchListIndicesParams,
  ElasticsearchListIndicesResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'

export const listIndicesTool: ToolConfig<
  ElasticsearchListIndicesParams,
  ElasticsearchListIndicesResponse
> = {
  id: 'elasticsearch_list_indices',
  name: 'Elasticsearch List Indices',
  description:
    'List all indices in the Elasticsearch cluster with their health, status, and statistics.',
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
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      return `${baseUrl}/_cat/indices?format=json`
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
        output: {
          message: errorMessage,
          indices: [],
        },
        error: errorMessage,
      }
    }

    const data = await response.json()

    const indices = data
      .filter((item: Record<string, unknown>) => {
        const indexName = item.index as string
        return !indexName.startsWith('.')
      })
      .map((item: Record<string, unknown>) => ({
        index: item.index as string,
        health: item.health as string,
        status: item.status as string,
        docsCount: Number.parseInt(item['docs.count'] as string, 10) || 0,
        storeSize: (item['store.size'] as string) || '0b',
        primaryShards: Number.parseInt(item.pri as string, 10) || 0,
        replicaShards: Number.parseInt(item.rep as string, 10) || 0,
      }))

    return {
      success: true,
      output: {
        message: `Found ${indices.length} indices`,
        indices,
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Summary message about the indices',
    },
    indices: {
      type: 'json',
      description: 'Array of index information objects',
    },
  },
}
