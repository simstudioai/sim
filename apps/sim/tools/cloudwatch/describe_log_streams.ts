import type {
  CloudWatchDescribeLogStreamsParams,
  CloudWatchDescribeLogStreamsResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const describeLogStreamsTool: ToolConfig<
  CloudWatchDescribeLogStreamsParams,
  CloudWatchDescribeLogStreamsResponse
> = {
  id: 'cloudwatch_describe_log_streams',
  name: 'CloudWatch Describe Log Streams',
  description: 'List log streams within a CloudWatch log group',
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
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter log streams by name prefix',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of log streams to return',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/describe-log-streams',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      logGroupName: params.logGroupName,
      ...(params.prefix && { prefix: params.prefix }),
      ...(params.limit !== undefined && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudWatch log streams')
    }

    return {
      success: true,
      output: {
        logStreams: data.output.logStreams,
      },
    }
  },

  outputs: {
    logStreams: {
      type: 'array',
      description:
        'List of log streams with metadata, sorted by last event time (most recent first) unless a prefix filter is applied',
      items: {
        type: 'object',
        properties: {
          logStreamName: { type: 'string', description: 'Log stream name' },
          lastEventTimestamp: {
            type: 'number',
            description: 'Timestamp of the last log event in epoch milliseconds',
          },
          firstEventTimestamp: {
            type: 'number',
            description: 'Timestamp of the first log event in epoch milliseconds',
          },
          creationTime: {
            type: 'number',
            description: 'Stream creation time in epoch milliseconds',
          },
          storedBytes: { type: 'number', description: 'Total stored bytes' },
        },
      },
    },
  },
}
