import type {
  CloudTrailGetTrailStatusParams,
  CloudTrailGetTrailStatusResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const getTrailStatusTool: InternalToolConfig<
  CloudTrailGetTrailStatusParams,
  CloudTrailGetTrailStatusResponse
> = {
  id: 'cloudtrail_get_trail_status',
  name: 'CloudTrail Get Trail Status',
  description:
    'Check whether a CloudTrail trail is logging and surface its most recent delivery errors',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Trail name, or the trail ARN. An organization trail read from a member account must be given as an ARN',
    },
  },

  operation: {
    input: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      name: params.name,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CloudTrail trail status')
    }
    return {
      success: true,
      output: {
        isLogging: data.output.isLogging ?? null,
        latestDeliveryError: data.output.latestDeliveryError ?? null,
        latestDeliveryTime: data.output.latestDeliveryTime ?? null,
        latestNotificationError: data.output.latestNotificationError ?? null,
        latestNotificationTime: data.output.latestNotificationTime ?? null,
        latestCloudWatchLogsDeliveryError: data.output.latestCloudWatchLogsDeliveryError ?? null,
        latestCloudWatchLogsDeliveryTime: data.output.latestCloudWatchLogsDeliveryTime ?? null,
        latestDigestDeliveryError: data.output.latestDigestDeliveryError ?? null,
        latestDigestDeliveryTime: data.output.latestDigestDeliveryTime ?? null,
        startLoggingTime: data.output.startLoggingTime ?? null,
        stopLoggingTime: data.output.stopLoggingTime ?? null,
      },
    }
  },

  outputs: {
    isLogging: {
      type: 'boolean',
      description: 'Whether the trail is currently recording API calls',
    },
    latestDeliveryError: {
      type: 'string',
      description: 'Most recent S3 error encountered delivering log files',
      optional: true,
    },
    latestDeliveryTime: {
      type: 'string',
      description: 'When log files were last delivered to S3 (ISO 8601)',
      optional: true,
    },
    latestNotificationError: {
      type: 'string',
      description: 'Most recent SNS error encountered sending a notification',
      optional: true,
    },
    latestNotificationTime: {
      type: 'string',
      description: 'When the last SNS notification was sent (ISO 8601)',
      optional: true,
    },
    latestCloudWatchLogsDeliveryError: {
      type: 'string',
      description: 'Most recent CloudWatch Logs delivery error',
      optional: true,
    },
    latestCloudWatchLogsDeliveryTime: {
      type: 'string',
      description: 'When events were last delivered to CloudWatch Logs (ISO 8601)',
      optional: true,
    },
    latestDigestDeliveryError: {
      type: 'string',
      description: 'Most recent S3 error encountered delivering a digest file',
      optional: true,
    },
    latestDigestDeliveryTime: {
      type: 'string',
      description: 'When a digest file was last delivered to S3 (ISO 8601)',
      optional: true,
    },
    startLoggingTime: {
      type: 'string',
      description: 'When logging was most recently started (ISO 8601)',
      optional: true,
    },
    stopLoggingTime: {
      type: 'string',
      description: 'When logging was most recently stopped (ISO 8601)',
      optional: true,
    },
  },
}
