import type {
  CloudWatchListMetricsParams,
  CloudWatchListMetricsResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const listMetricsTool: ToolConfig<
  CloudWatchListMetricsParams,
  CloudWatchListMetricsResponse
> = {
  id: 'cloudwatch_list_metrics',
  name: 'CloudWatch List Metrics',
  description: 'List available CloudWatch metrics',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    namespace: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by namespace (e.g., AWS/EC2, AWS/Lambda)',
    },
    metricName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by metric name',
    },
    recentlyActive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only show metrics active in the last 3 hours',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of metrics to return',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/list-metrics',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.namespace && { namespace: params.namespace }),
      ...(params.metricName && { metricName: params.metricName }),
      ...(params.recentlyActive && { recentlyActive: params.recentlyActive }),
      ...(params.limit !== undefined && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list CloudWatch metrics')
    }

    return {
      success: true,
      output: {
        metrics: data.output.metrics,
      },
    }
  },

  outputs: {
    metrics: {
      type: 'array',
      description: 'List of metrics with namespace, name, and dimensions',
      items: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Metric namespace (e.g., AWS/EC2)' },
          metricName: { type: 'string', description: 'Metric name (e.g., CPUUtilization)' },
          dimensions: { type: 'array', description: 'Array of name/value dimension pairs' },
        },
      },
    },
  },
}
