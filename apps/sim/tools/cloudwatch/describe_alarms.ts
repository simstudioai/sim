import type {
  CloudWatchDescribeAlarmsParams,
  CloudWatchDescribeAlarmsResponse,
} from '@/tools/cloudwatch/types'
import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const describeAlarmsTool: InternalToolConfig<
  CloudWatchDescribeAlarmsParams,
  CloudWatchDescribeAlarmsResponse
> = {
  id: 'cloudwatch_describe_alarms',
  name: 'CloudWatch Describe Alarms',
  description: 'List and filter CloudWatch alarms',
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
    alarmNamePrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter alarms by name prefix',
    },
    stateValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by alarm state (OK, ALARM, INSUFFICIENT_DATA)',
    },
    alarmType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by alarm type (MetricAlarm, CompositeAlarm)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of alarms to return',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous call',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.alarmNamePrefix && { alarmNamePrefix: params.alarmNamePrefix }),
      ...(params.stateValue && { stateValue: params.stateValue }),
      ...(params.alarmType && { alarmType: params.alarmType }),
      ...(params.limit !== undefined && { limit: params.limit }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudWatch alarms')
    }

    return {
      success: true,
      output: {
        alarms: data.output.alarms,
        nextToken: data.output.nextToken ?? null,
      },
    }
  },

  outputs: {
    alarms: {
      type: 'array',
      description: 'List of CloudWatch alarms with state and configuration',
      items: {
        type: 'object',
        properties: {
          alarmName: { type: 'string', description: 'Alarm name' },
          alarmArn: { type: 'string', description: 'Alarm ARN' },
          stateValue: {
            type: 'string',
            description: 'Current state (OK, ALARM, INSUFFICIENT_DATA)',
          },
          stateReason: { type: 'string', description: 'Human-readable reason for the state' },
          metricName: { type: 'string', description: 'Metric name (MetricAlarm only)' },
          namespace: { type: 'string', description: 'Metric namespace (MetricAlarm only)' },
          threshold: { type: 'number', description: 'Threshold value (MetricAlarm only)' },
          comparisonOperator: {
            type: 'string',
            description: 'Comparison operator (MetricAlarm only)',
          },
          evaluationPeriods: {
            type: 'number',
            description: 'Number of periods evaluated (MetricAlarm only)',
          },
          stateUpdatedTimestamp: {
            type: 'number',
            description: 'Epoch ms when state last changed',
          },
          alarmType: { type: 'string', description: 'MetricAlarm or CompositeAlarm' },
          alarmDescription: { type: 'string', description: 'Alarm description' },
          actionsEnabled: {
            type: 'boolean',
            description: 'Whether actions run on state changes',
          },
          alarmActions: { type: 'array', description: 'ARNs of actions run on ALARM' },
          okActions: { type: 'array', description: 'ARNs of actions run on OK' },
          insufficientDataActions: {
            type: 'array',
            description: 'ARNs of actions run on INSUFFICIENT_DATA',
          },
          stateReasonData: {
            type: 'string',
            description: 'Machine-readable JSON explaining the state',
          },
          stateTransitionedTimestamp: {
            type: 'number',
            description: 'Epoch ms when the state value last changed',
          },
          alarmConfigurationUpdatedTimestamp: {
            type: 'number',
            description: 'Epoch ms when the alarm configuration last changed',
          },
          statistic: { type: 'string', description: 'Statistic evaluated (MetricAlarm only)' },
          extendedStatistic: {
            type: 'string',
            description: 'Percentile statistic evaluated (MetricAlarm only)',
          },
          dimensions: {
            type: 'array',
            description: 'Metric dimensions as {name, value} (MetricAlarm only)',
          },
          period: {
            type: 'number',
            description: 'Evaluation period in seconds (MetricAlarm only)',
          },
          unit: { type: 'string', description: 'Metric unit (MetricAlarm only)' },
          datapointsToAlarm: {
            type: 'number',
            description: 'Breaching datapoints needed to alarm (MetricAlarm only)',
          },
          treatMissingData: {
            type: 'string',
            description: 'How missing data is treated (MetricAlarm only)',
          },
          thresholdMetricId: {
            type: 'string',
            description: 'ID of the metric-math threshold query (anomaly detection alarms)',
          },
          metrics: {
            type: 'array',
            description:
              'Metric-math queries [{id, expression, label, returnData, period, accountId, metricStat}] (MetricAlarm only)',
          },
          alarmRule: { type: 'string', description: 'Rule expression (CompositeAlarm only)' },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of alarms',
      optional: true,
    },
  },
}
