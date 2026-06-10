import type {
  DatabricksGetClusterParams,
  DatabricksGetClusterResponse,
} from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const getClusterTool: ToolConfig<DatabricksGetClusterParams, DatabricksGetClusterResponse> =
  {
    id: 'databricks_get_cluster',
    name: 'Databricks Get Cluster',
    description:
      'Get the state, configuration, and resource details of a single Databricks cluster by its cluster ID.',
    version: '1.0.0',

    params: {
      host: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Databricks workspace host (e.g., dbc-abc123.cloud.databricks.com)',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Databricks Personal Access Token',
      },
      clusterId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the cluster to retrieve',
      },
    },

    request: {
      url: (params) => {
        const host = params.host
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\/$/, '')
        const url = new URL(`https://${host}/api/2.0/clusters/get`)
        url.searchParams.set('cluster_id', params.clusterId.trim())
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        Accept: 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error?.message || 'Failed to get cluster')
      }

      return {
        success: true,
        output: {
          cluster: {
            clusterId: data.cluster_id ?? '',
            clusterName: data.cluster_name ?? '',
            state: data.state ?? 'UNKNOWN',
            stateMessage: data.state_message ?? '',
            creatorUserName: data.creator_user_name ?? '',
            sparkVersion: data.spark_version ?? '',
            nodeTypeId: data.node_type_id ?? '',
            driverNodeTypeId: data.driver_node_type_id ?? '',
            numWorkers: data.num_workers ?? null,
            autoscale: data.autoscale
              ? {
                  minWorkers: data.autoscale.min_workers ?? 0,
                  maxWorkers: data.autoscale.max_workers ?? 0,
                }
              : null,
            clusterSource: data.cluster_source ?? '',
            autoterminationMinutes: data.autotermination_minutes ?? 0,
            startTime: data.start_time ?? null,
          },
        },
      }
    },

    outputs: {
      cluster: {
        type: 'object',
        description: 'Cluster detail',
        properties: {
          clusterId: { type: 'string', description: 'Unique cluster identifier' },
          clusterName: { type: 'string', description: 'Cluster display name' },
          state: {
            type: 'string',
            description:
              'Current state (PENDING, RUNNING, RESTARTING, RESIZING, TERMINATING, TERMINATED, ERROR, UNKNOWN)',
          },
          stateMessage: { type: 'string', description: 'Human-readable state description' },
          creatorUserName: { type: 'string', description: 'Email of the cluster creator' },
          sparkVersion: {
            type: 'string',
            description: 'Spark runtime version (e.g., 13.3.x-scala2.12)',
          },
          nodeTypeId: { type: 'string', description: 'Worker node type identifier' },
          driverNodeTypeId: { type: 'string', description: 'Driver node type identifier' },
          numWorkers: {
            type: 'number',
            description: 'Number of worker nodes (for fixed-size clusters)',
            optional: true,
          },
          autoscale: {
            type: 'object',
            description: 'Autoscaling configuration (null for fixed-size clusters)',
            optional: true,
            properties: {
              minWorkers: { type: 'number', description: 'Minimum number of workers' },
              maxWorkers: { type: 'number', description: 'Maximum number of workers' },
            },
          },
          clusterSource: {
            type: 'string',
            description: 'Origin (API, UI, JOB, MODELS, PIPELINE, PIPELINE_MAINTENANCE, SQL)',
          },
          autoterminationMinutes: {
            type: 'number',
            description: 'Minutes of inactivity before auto-termination (0 = disabled)',
          },
          startTime: {
            type: 'number',
            description: 'Cluster start timestamp (epoch ms)',
            optional: true,
          },
        },
      },
    },
  }
