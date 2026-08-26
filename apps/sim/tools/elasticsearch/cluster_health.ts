import type {
  ElasticsearchClusterHealthParams,
  ElasticsearchClusterHealthResponse,
} from '@/tools/elasticsearch/types'
import { buildAuthHeaders, buildBaseUrl, normalizeEsDuration } from '@/tools/elasticsearch/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const clusterHealthTool: ToolConfig<
  ElasticsearchClusterHealthParams,
  ElasticsearchClusterHealthResponse
> = {
  id: 'elasticsearch_cluster_health',
  name: 'Elasticsearch Cluster Health',
  description: 'Get the health status of the Elasticsearch cluster.',
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
    waitForStatus: {
      type: 'string',
      required: false,
      description: 'Wait until cluster reaches this status: green, yellow, or red',
    },
    esTimeout: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Elasticsearch wait timeout as a duration string (e.g., 30s, 1m). A bare number is read as seconds. Named esTimeout because the executor reserves "timeout" for the transport deadline in milliseconds.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      let url = `${baseUrl}/_cluster/health`

      const queryParams: string[] = []
      if (params.waitForStatus) {
        queryParams.push(`wait_for_status=${encodeURIComponent(params.waitForStatus)}`)
      }
      const esTimeout = normalizeEsDuration(params.esTimeout)
      if (esTimeout) {
        queryParams.push(`timeout=${encodeURIComponent(esTimeout)}`)
      }
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`
      }

      return url
    },
    method: 'GET',
    headers: (params) => buildAuthHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        cluster_name: data.cluster_name,
        status: data.status,
        timed_out: data.timed_out,
        number_of_nodes: data.number_of_nodes,
        number_of_data_nodes: data.number_of_data_nodes,
        active_primary_shards: data.active_primary_shards,
        active_shards: data.active_shards,
        relocating_shards: data.relocating_shards,
        initializing_shards: data.initializing_shards,
        unassigned_shards: data.unassigned_shards,
        delayed_unassigned_shards: data.delayed_unassigned_shards,
        number_of_pending_tasks: data.number_of_pending_tasks,
        number_of_in_flight_fetch: data.number_of_in_flight_fetch,
        task_max_waiting_in_queue_millis: data.task_max_waiting_in_queue_millis,
        active_shards_percent_as_number: data.active_shards_percent_as_number,
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
      description: 'Cluster health status: green, yellow, or red',
    },
    number_of_nodes: {
      type: 'number',
      description: 'Total number of nodes in the cluster',
    },
    number_of_data_nodes: {
      type: 'number',
      description: 'Number of data nodes',
    },
    active_shards: {
      type: 'number',
      description: 'Number of active shards',
    },
    unassigned_shards: {
      type: 'number',
      description: 'Number of unassigned shards',
    },
  },
}
