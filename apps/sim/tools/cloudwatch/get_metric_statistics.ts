import type {
  CloudWatchGetMetricStatisticsParams,
  CloudWatchGetMetricStatisticsResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const getMetricStatisticsTool: ToolConfig<
  CloudWatchGetMetricStatisticsParams,
  CloudWatchGetMetricStatisticsResponse
> = {
  id: 'cloudwatch_get_metric_statistics',
  name: 'CloudWatch Get Metric Statistics',
  description: 'Get statistics for a CloudWatch metric over a time range',
  version: '1.0',

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
      description: 'Metric namespace (e.g., AWS/EC2, AWS/Lambda)',
    },
    metricName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Metric name (e.g., CPUUtilization, Invocations)',
    },
    startTime: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start time as Unix epoch seconds',
    },
    endTime: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'End time as Unix epoch seconds',
    },
    period: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Granularity in seconds (e.g., 60, 300, 3600)',
    },
    statistics: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Statistics to retrieve (Average, Sum, Minimum, Maximum, SampleCount)',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dimensions as JSON (e.g., {"InstanceId": "i-1234"})',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/get-metric-statistics',
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
      startTime: params.startTime,
      endTime: params.endTime,
      period: params.period,
      statistics: params.statistics,
      ...(params.dimensions && { dimensions: params.dimensions }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudWatch metric statistics')
    }

    return {
      success: true,
      output: {
        label: data.output.label,
        datapoints: data.output.datapoints,
      },
    }
  },

  outputs: {
    label: { type: 'string', description: 'Metric label' },
    datapoints: { type: 'array', description: 'Datapoints with timestamp and statistics values' },
  },
}
