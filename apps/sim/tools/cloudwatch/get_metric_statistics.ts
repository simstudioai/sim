import type {
  CloudWatchGetMetricStatisticsParams,
  CloudWatchGetMetricStatisticsResponse,
} from '@/tools/cloudwatch/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const getMetricStatisticsTool: InternalToolConfig<
  CloudWatchGetMetricStatisticsParams,
  CloudWatchGetMetricStatisticsResponse
> = {
  id: 'cloudwatch_get_metric_statistics',
  name: 'CloudWatch Get Metric Statistics',
  description: 'Get statistics for a CloudWatch metric over a time range',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Statistics to retrieve (Average, Sum, Minimum, Maximum, SampleCount). Required unless extendedStatistics is set, which takes precedence',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dimensions as JSON (e.g., {"InstanceId": "i-1234"})',
    },
    extendedStatistics: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Percentile statistics to retrieve (e.g., ["p99", "p95"]). AWS accepts either Statistics or ExtendedStatistics, so when set these are requested instead of statistics',
    },
    unit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return data reported with this unit (e.g., Percent, Milliseconds). Omit to return all units',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      namespace: params.namespace,
      metricName: params.metricName,
      startTime: params.startTime,
      endTime: params.endTime,
      period: params.period,
      ...(params.statistics && params.statistics.length > 0 && { statistics: params.statistics }),
      ...(params.dimensions && { dimensions: params.dimensions }),
      ...(params.extendedStatistics &&
        params.extendedStatistics.length > 0 && {
          extendedStatistics: params.extendedStatistics,
        }),
      ...(params.unit && { unit: params.unit }),
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
    label: { type: 'string', description: 'Metric label returned by CloudWatch' },
    datapoints: {
      type: 'array',
      description: 'Datapoints sorted by timestamp with statistics values',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'number', description: 'Datapoint timestamp in epoch milliseconds' },
          average: { type: 'number', description: 'Average statistic value' },
          sum: { type: 'number', description: 'Sum statistic value' },
          minimum: { type: 'number', description: 'Minimum statistic value' },
          maximum: { type: 'number', description: 'Maximum statistic value' },
          sampleCount: { type: 'number', description: 'Sample count statistic value' },
          unit: { type: 'string', description: 'Unit of the metric' },
          extendedStatistics: {
            type: 'json',
            description: 'Percentile values keyed by statistic (e.g., {"p99": 120.5})',
          },
        },
      },
    },
  },
}
