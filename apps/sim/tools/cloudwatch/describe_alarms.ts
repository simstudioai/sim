import type {
  CloudWatchDescribeAlarmsParams,
  CloudWatchDescribeAlarmsResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const describeAlarmsTool: ToolConfig<
  CloudWatchDescribeAlarmsParams,
  CloudWatchDescribeAlarmsResponse
> = {
  id: 'cloudwatch_describe_alarms',
  name: 'CloudWatch Describe Alarms',
  description: 'List and filter CloudWatch alarms',
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
  },

  request: {
    url: '/api/tools/cloudwatch/describe-alarms',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.alarmNamePrefix && { alarmNamePrefix: params.alarmNamePrefix }),
      ...(params.stateValue && { stateValue: params.stateValue }),
      ...(params.alarmType && { alarmType: params.alarmType }),
      ...(params.limit !== undefined && { limit: params.limit }),
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
          stateUpdatedTimestamp: {
            type: 'number',
            description: 'Epoch ms when state last changed',
          },
        },
      },
    },
  },
}
