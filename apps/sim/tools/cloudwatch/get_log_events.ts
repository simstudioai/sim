import type {
  CloudWatchGetLogEventsParams,
  CloudWatchGetLogEventsResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const getLogEventsTool: ToolConfig<
  CloudWatchGetLogEventsParams,
  CloudWatchGetLogEventsResponse
> = {
  id: 'cloudwatch_get_log_events',
  name: 'CloudWatch Get Log Events',
  description: 'Retrieve log events from a specific CloudWatch log stream',
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
    logGroupName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CloudWatch log group name',
    },
    logStreamName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CloudWatch log stream name',
    },
    startTime: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start time as Unix epoch seconds',
    },
    endTime: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'End time as Unix epoch seconds',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/get-log-events',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      logGroupName: params.logGroupName,
      logStreamName: params.logStreamName,
      ...(params.startTime !== undefined && { startTime: params.startTime }),
      ...(params.endTime !== undefined && { endTime: params.endTime }),
      ...(params.limit !== undefined && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudWatch log events')
    }

    return {
      success: true,
      output: {
        events: data.output.events,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Log events with timestamp, message, and ingestion time',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'number', description: 'Event timestamp in epoch milliseconds' },
          message: { type: 'string', description: 'Log event message' },
          ingestionTime: { type: 'number', description: 'Ingestion time in epoch milliseconds' },
        },
      },
    },
  },
}
