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
  description: 'Delete a CloudWatch alarm mute rule, restoring alarm notifications',
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
    muteRuleName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the mute rule to delete',
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
      muteRuleName: params.muteRuleName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete CloudWatch alarm mute rule')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the mute rule was deleted successfully' },
    muteRuleName: { type: 'string', description: 'Name of the mute rule that was deleted' },
  },
}
