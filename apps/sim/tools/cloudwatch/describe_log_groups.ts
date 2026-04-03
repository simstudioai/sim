import type {
  CloudWatchDescribeLogGroupsParams,
  CloudWatchDescribeLogGroupsResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const describeLogGroupsTool: ToolConfig<
  CloudWatchDescribeLogGroupsParams,
  CloudWatchDescribeLogGroupsResponse
> = {
  id: 'cloudwatch_describe_log_groups',
  name: 'CloudWatch Describe Log Groups',
  description: 'List available CloudWatch log groups',
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
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter log groups by name prefix',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of log groups to return',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/describe-log-groups',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.prefix && { prefix: params.prefix }),
      ...(params.limit !== undefined && { limit: params.limit }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudWatch log groups')
    }

    return {
      success: true,
      output: {
        logGroups: data.output.logGroups,
      },
    }
  },

  outputs: {
    logGroups: { type: 'array', description: 'List of CloudWatch log groups with metadata' },
  },
}
