import type {
  CloudWatchFilterLogEventsParams,
  CloudWatchFilterLogEventsResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const filterLogEventsTool: ToolConfig<
  CloudWatchFilterLogEventsParams,
  CloudWatchFilterLogEventsResponse
> = {
  id: 'cloudwatch_filter_log_events',
  name: 'CloudWatch Filter Log Events',
  description:
    'Search log events across all streams in a log group by filter pattern and time range, without writing a Log Insights query',
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
      description: 'CloudWatch log group name to search',
    },
    filterPattern: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CloudWatch Logs filter pattern (e.g., "ERROR", "?ERROR ?Exception"). Matches all events if omitted.',
    },
    logStreamNamePrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only search log streams whose name starts with this prefix',
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
    startFromHead: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return the earliest matching events first instead of the latest',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/filter-log-events',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      logGroupName: params.logGroupName,
      ...(params.filterPattern && { filterPattern: params.filterPattern }),
      ...(params.logStreamNamePrefix && { logStreamNamePrefix: params.logStreamNamePrefix }),
      ...(params.startTime !== undefined && { startTime: params.startTime }),
      ...(params.endTime !== undefined && { endTime: params.endTime }),
      ...(params.startFromHead !== undefined && { startFromHead: params.startFromHead }),
      ...(params.limit !== undefined && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to filter CloudWatch log events')
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
      description: 'Matching log events across all searched streams, sorted by timestamp',
      items: {
        type: 'object',
        properties: {
          logStreamName: { type: 'string', description: 'Log stream the event belongs to' },
          timestamp: { type: 'number', description: 'Event timestamp in epoch milliseconds' },
          message: { type: 'string', description: 'Log event message' },
          ingestionTime: { type: 'number', description: 'Ingestion time in epoch milliseconds' },
        },
      },
    },
  },
}
