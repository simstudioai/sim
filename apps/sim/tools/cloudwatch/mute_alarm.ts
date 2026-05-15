import type {
  CloudWatchMuteAlarmParams,
  CloudWatchMuteAlarmResponse,
} from '@/tools/cloudwatch/types'
import type { ToolConfig } from '@/tools/types'

export const muteAlarmTool: ToolConfig<CloudWatchMuteAlarmParams, CloudWatchMuteAlarmResponse> = {
  id: 'cloudwatch_mute_alarm',
  name: 'CloudWatch Mute Alarm',
  description: 'Create a CloudWatch alarm mute rule that suppresses alarms for a fixed duration',
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
      description: 'Unique name for the mute rule (used later to unmute)',
    },
    alarmNames: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Names of the CloudWatch alarms this mute rule targets',
    },
    durationValue: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'How long the mute lasts (paired with durationUnit)',
    },
    durationUnit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unit for durationValue: minutes, hours, or days',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional description of why the alarms are being muted',
    },
    startDate: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When the mute window begins as Unix epoch seconds. Defaults to now (mute starts immediately).',
    },
  },

  request: {
    url: '/api/tools/cloudwatch/mute-alarm',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      muteRuleName: params.muteRuleName,
      alarmNames: params.alarmNames,
      durationValue: params.durationValue,
      durationUnit: params.durationUnit,
      ...(params.description && { description: params.description }),
      ...(params.startDate !== undefined && { startDate: params.startDate }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create CloudWatch alarm mute rule')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the mute rule was created successfully' },
    muteRuleName: { type: 'string', description: 'Name of the mute rule that was created' },
    alarmNames: {
      type: 'array',
      description: 'Names of the alarms this rule mutes',
      items: { type: 'string' },
    },
    expression: { type: 'string', description: 'Schedule expression used by the mute rule' },
    duration: { type: 'string', description: 'ISO 8601 duration of the mute window' },
  },
}
