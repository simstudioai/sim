import type {
  ElasticsearchClusterHealthParams,
  ElasticsearchClusterHealthResponse,
} from '@/tools/elasticsearch/types'
import type { ToolConfig } from '@/tools/types'

function buildBaseUrl(params: ElasticsearchClusterHealthParams): string {
  if (params.deploymentType === 'cloud' && params.cloudId) {
    const parts = params.cloudId.split(':')
    if (parts.length >= 2) {
      try {
        const decoded = Buffer.from(parts[1], 'base64').toString('utf-8')
        const [esHost] = decoded.split('$')
        if (esHost) {
          return `https://${parts[0]}.${esHost}`
        }
      } catch {
        // Fallback
      }
    }
    throw new Error('Invalid Cloud ID format')
  }

  if (!params.host) {
    throw new Error('Host is required for self-hosted deployments')
  }

  return params.host.replace(/\/$/, '')
}

function buildAuthHeaders(params: ElasticsearchClusterHealthParams): Record<string, string> {
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

export const clusterHealthTool: ToolConfig<
  ElasticsearchClusterHealthParams,
  ElasticsearchClusterHealthResponse
> = {
  id: 'elasticsearch_cluster_health',
  name: 'Elasticsearch Cluster Health',
  description: 'Get the health status of the Elasticsearch cluster.',
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
    waitForStatus: {
      type: 'string',
      required: false,
      description: 'Wait until cluster reaches this status: green, yellow, or red',
    },
    timeout: {
      type: 'string',
      required: false,
      description: 'Timeout for the wait operation (e.g., 30s, 1m)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = buildBaseUrl(params)
      let url = `${baseUrl}/_cluster/health`

      const queryParams: string[] = []
      if (params.waitForStatus) {
        queryParams.push(`wait_for_status=${params.waitForStatus}`)
      }
      if (params.timeout) {
        queryParams.push(`timeout=${encodeURIComponent(params.timeout)}`)
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
          status: 'red' as const,
          timed_out: true,
          number_of_nodes: 0,
          number_of_data_nodes: 0,
          active_primary_shards: 0,
          active_shards: 0,
          relocating_shards: 0,
          initializing_shards: 0,
          unassigned_shards: 0,
          delayed_unassigned_shards: 0,
          number_of_pending_tasks: 0,
          number_of_in_flight_fetch: 0,
          task_max_waiting_in_queue_millis: 0,
          active_shards_percent_as_number: 0,
        },
        error: errorMessage,
      }
    }

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
