import type {
  CloudWatchUnmuteAlarmParams,
  CloudWatchUnmuteAlarmResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const unmuteAlarmTool: ToolConfig<
  CloudWatchUnmuteAlarmParams,
  CloudWatchUnmuteAlarmResponse
> = {
  id: 'cloudwatch_unmute_alarm',
  name: 'CloudWatch Unmute Alarm',
  description: 'Re-enable notification actions on one or more CloudWatch alarms',
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
    alarmNames: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Names of the CloudWatch alarms to unmute',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/unmute-alarm',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      alarmNames: params.alarmNames,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to unmute CloudWatch alarm')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the alarms were unmuted successfully' },
    alarmNames: {
      type: 'array',
      description: 'Names of the alarms that were unmuted',
      items: { type: 'string' },
    },
  },
}
