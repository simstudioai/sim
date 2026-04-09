import type {
  CloudWatchPutMetricDataParams,
  CloudWatchPutMetricDataResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const putMetricDataTool: ToolConfig<
  CloudWatchPutMetricDataParams,
  CloudWatchPutMetricDataResponse
> = {
  id: 'cloudwatch_put_metric_data',
  name: 'CloudWatch Publish Metric',
  description: 'Publish a custom metric data point to CloudWatch',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Metric namespace (e.g., Custom/MyApp)',
    },
    metricName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the metric',
    },
    value: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Metric value to publish',
    },
    unit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unit of the metric (e.g., Count, Seconds, Bytes)',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON string of dimension name/value pairs',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/put-metric-data',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      namespace: params.namespace,
      metricName: params.metricName,
      value: params.value,
      ...(params.unit && { unit: params.unit }),
      ...(params.dimensions && { dimensions: params.dimensions }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to publish CloudWatch metric')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the metric was published successfully' },
    namespace: { type: 'string', description: 'Metric namespace' },
    metricName: { type: 'string', description: 'Metric name' },
    value: { type: 'number', description: 'Published metric value' },
    unit: { type: 'string', description: 'Metric unit' },
    timestamp: { type: 'string', description: 'Timestamp when the metric was published' },
  },
}
