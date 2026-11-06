import type {
  DatabricksGetClusterParams,
  DatabricksGetClusterResponse,
} from '@/tools/databricks/types'
import { databricksUrl } from '@/tools/databricks/utils'
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
        const url = new URL(databricksUrl(params.host, '/api/2.1/clusters/get'))
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
            policyId: data.policy_id ?? null,
            dataSecurityMode: data.data_security_mode ?? null,
            terminatedTime: data.terminated_time ?? null,
            customTags: data.custom_tags ?? null,
            terminationReason: data.termination_reason ?? null,
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
          policyId: { type: 'string', nullable: true, description: 'Compute policy identifier' },
          dataSecurityMode: { type: 'string', nullable: true, description: 'Cluster access mode' },
          terminatedTime: {
            type: 'number',
            nullable: true,
            description: 'Cluster termination time in epoch milliseconds',
          },
          customTags: { type: 'object', nullable: true, description: 'Custom cluster tags' },
          terminationReason: {
            type: 'object',
            nullable: true,
            description: 'Reason for termination (code, type, parameters)',
            properties: {
              code: { type: 'string' },
              type: { type: 'string' },
              parameters: {
                type: 'object',
                description: 'Provider-specific termination parameters',
              },
            },
          },
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
            nullable: true,
          },
          autoscale: {
            type: 'object',
            description: 'Autoscaling configuration (null for fixed-size clusters)',
            nullable: true,
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
            nullable: true,
          },
        },
      },
    },
  }
