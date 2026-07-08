import type {
  CloudWatchPutLogGroupRetentionParams,
  CloudWatchPutLogGroupRetentionResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const putLogGroupRetentionTool: ToolConfig<
  CloudWatchPutLogGroupRetentionParams,
  CloudWatchPutLogGroupRetentionResponse
> = {
  id: 'cloudwatch_put_log_group_retention',
  name: 'CloudWatch Set Log Group Retention',
  description: 'Set (or clear, for never-expire) the retention period for a CloudWatch log group',
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
    retentionInDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Days to retain log events (one of 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653). Omit to make events never expire.',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/put-log-group-retention',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      logGroupName: params.logGroupName,
      ...(params.retentionInDays !== undefined && { retentionInDays: params.retentionInDays }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set CloudWatch log group retention')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the retention policy was updated' },
    logGroupName: { type: 'string', description: 'Log group the policy applies to' },
    retentionInDays: {
      type: 'number',
      description: 'Retention period in days, or null if events never expire',
      optional: true,
    },
  },
}
