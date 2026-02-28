import type { DatabricksBaseParams, DatabricksListClustersResponse } from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const listClustersTool: ToolConfig<DatabricksBaseParams, DatabricksListClustersResponse> = {
  id: 'databricks_list_clusters',
  name: 'Databricks List Clusters',
  description:
    'List all clusters in a Databricks workspace including their state, configuration, and resource details.',
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
  },

  request: {
    url: (params) => {
      const host = params.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      return `https://${host}/api/2.0/clusters/list`
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
      throw new Error(data.message || data.error?.message || 'Failed to list clusters')
    }

    const clusters = (data.clusters ?? []).map(
      (cluster: {
        cluster_id?: string
        cluster_name?: string
        state?: string
        state_message?: string
        creator_user_name?: string
        spark_version?: string
        node_type_id?: string
        driver_node_type_id?: string
        num_workers?: number
        autoscale?: { min_workers?: number; max_workers?: number }
        cluster_source?: string
        autotermination_minutes?: number
        start_time?: number
      }) => ({
        clusterId: cluster.cluster_id ?? '',
        clusterName: cluster.cluster_name ?? '',
        state: cluster.state ?? 'UNKNOWN',
        stateMessage: cluster.state_message ?? '',
        creatorUserName: cluster.creator_user_name ?? '',
        sparkVersion: cluster.spark_version ?? '',
        nodeTypeId: cluster.node_type_id ?? '',
        driverNodeTypeId: cluster.driver_node_type_id ?? '',
        numWorkers: cluster.num_workers ?? null,
        autoscale: cluster.autoscale
          ? {
              minWorkers: cluster.autoscale.min_workers ?? 0,
              maxWorkers: cluster.autoscale.max_workers ?? 0,
            }
          : null,
        clusterSource: cluster.cluster_source ?? '',
        autoterminationMinutes: cluster.autotermination_minutes ?? 0,
        startTime: cluster.start_time ?? null,
      })
    )

    return {
      success: true,
      output: {
        clusters,
      },
    }
  },

  outputs: {
    clusters: {
      type: 'array',
      description: 'List of clusters in the workspace',
      items: {
        type: 'object',
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
  },
}
