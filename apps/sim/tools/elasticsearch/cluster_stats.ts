import type {
  ElasticsearchClusterStatsParams,
  ElasticsearchClusterStatsResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl } from '@/tools/elasticsearch/utils'
import type { ToolConfig } from '@/tools/types'

export const clusterStatsTool: ToolConfig<
  ElasticsearchClusterStatsParams,
  ElasticsearchClusterStatsResponse
> = {
  id: 'elasticsearch_cluster_stats',
  name: 'Elasticsearch Cluster Stats',
  description: 'Get comprehensive statistics about the Elasticsearch cluster.',
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
      return `${baseUrl}/_cluster/stats`
    },
    method: 'GET',
    headers: (params) => buildAuthHeaders(params),
    /**
     * `host` is a user-supplied origin and Elastic Cloud endpoints sit behind
     * proxies, so a redirect off the configured origin must not carry the API
     * key or Basic credentials with it.
     */
    stripAuthOnRedirect: true,
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
          cluster_name: '',
          cluster_uuid: '',
          status: 'red',
          nodes: {
            count: { total: 0, data: 0, master: 0 },
            versions: [],
          },
          indices: {
            count: 0,
            docs: { count: 0, deleted: 0 },
            store: { size_in_bytes: 0 },
            shards: { total: 0, primaries: 0 },
          },
        },
        error: errorMessage,
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        cluster_name: data.cluster_name,
        cluster_uuid: data.cluster_uuid,
        status: data.status,
        nodes: {
          count: data.nodes?.count || { total: 0, data: 0, master: 0 },
          versions: data.nodes?.versions || [],
        },
        indices: {
          count: data.indices?.count || 0,
          docs: data.indices?.docs || { count: 0, deleted: 0 },
          store: data.indices?.store || { size_in_bytes: 0 },
          shards: data.indices?.shards || { total: 0, primaries: 0 },
        },
      },
    }
  },

  outputs: {
    cluster_name: {
      type: 'string',
      description: 'Name of the cluster',
    },
    status: {
      type: 'string',
      description: 'Cluster health status',
    },
    nodes: {
      type: 'object',
      description: 'Node statistics including count and versions',
    },
    indices: {
      type: 'object',
      description: 'Index statistics including document count and store size',
    },
  },
}
