import type {
  CloudWatchDescribeAlarmHistoryParams,
  CloudWatchDescribeAlarmHistoryResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const describeAlarmHistoryTool: ToolConfig<
  CloudWatchDescribeAlarmHistoryParams,
  CloudWatchDescribeAlarmHistoryResponse
> = {
  id: 'cloudwatch_describe_alarm_history',
  name: 'CloudWatch Describe Alarm History',
  description: 'Retrieve state-change and configuration history for CloudWatch alarms',
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
    alarmName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of a specific alarm to retrieve history for. Omit for all alarms.',
    },
    historyItemType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by history item type (ConfigurationUpdate, StateUpdate, Action, AlarmContributorStateUpdate, AlarmContributorAction)',
    },
    startDate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of the history window as Unix epoch seconds',
    },
    endDate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the history window as Unix epoch seconds',
    },
    scanBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: TimestampDescending (newest first) or TimestampAscending',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of history records to return',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/describe-alarm-history',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.alarmName && { alarmName: params.alarmName }),
      ...(params.historyItemType && { historyItemType: params.historyItemType }),
      ...(params.startDate !== undefined && { startDate: params.startDate }),
      ...(params.endDate !== undefined && { endDate: params.endDate }),
      ...(params.scanBy && { scanBy: params.scanBy }),
      ...(params.limit !== undefined && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudWatch alarm history')
    }

    return {
      success: true,
      output: {
        alarmHistoryItems: data.output.alarmHistoryItems,
      },
    }
  },

  outputs: {
    alarmHistoryItems: {
      type: 'array',
      description: 'Alarm history items sorted per scanBy, newest first by default',
      items: {
        type: 'object',
        properties: {
          alarmName: {
            type: 'string',
            description: 'Name of the alarm this history item belongs to',
          },
          alarmType: { type: 'string', description: 'MetricAlarm or CompositeAlarm' },
          timestamp: { type: 'number', description: 'Epoch ms when the history item occurred' },
          historyItemType: {
            type: 'string',
            description: 'ConfigurationUpdate, StateUpdate, Action, or contributor variants',
          },
          historySummary: { type: 'string', description: 'Human-readable summary of the event' },
        },
      },
    },
  },
}
