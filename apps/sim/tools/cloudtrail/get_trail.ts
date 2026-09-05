import type { CloudTrailGetTrailParams, CloudTrailGetTrailResponse } from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const getTrailTool: InternalToolConfig<
  CloudTrailGetTrailParams,
  CloudTrailGetTrailResponse
> = {
  id: 'cloudtrail_get_trail',
  name: 'CloudTrail Get Trail',
  description: 'Retrieve the settings of a single CloudTrail trail by name or ARN',
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
      description: 'Trail name, or the trail ARN for a trail in another Region',
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
      throw new Error(data.error || 'Failed to get CloudTrail trail')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Trail name',
    },
    s3BucketName: {
      type: 'string',
      description: 'Name of the S3 bucket that receives log files',
      optional: true,
    },
    s3KeyPrefix: {
      type: 'string',
      description: 'S3 key prefix prepended to delivered log files',
      optional: true,
    },
    snsTopicName: {
      type: 'string',
      description: 'Name of the SNS topic notified on log delivery',
      optional: true,
    },
    snsTopicArn: {
      type: 'string',
      description: 'ARN of the SNS topic notified on log delivery',
      optional: true,
    },
    includeGlobalServiceEvents: {
      type: 'boolean',
      description: 'Whether the trail records global service events',
      optional: true,
    },
    isMultiRegionTrail: {
      type: 'boolean',
      description: 'Whether the trail records events in all Regions',
      optional: true,
    },
    homeRegion: {
      type: 'string',
      description: 'Region in which the trail was created',
      optional: true,
    },
    trailArn: {
      type: 'string',
      description: 'ARN of the trail',
      optional: true,
    },
    logFileValidationEnabled: {
      type: 'boolean',
      description: 'Whether log file integrity validation is enabled',
      optional: true,
    },
    cloudWatchLogsLogGroupArn: {
      type: 'string',
      description: 'ARN of the CloudWatch Logs log group receiving events',
      optional: true,
    },
    cloudWatchLogsRoleArn: {
      type: 'string',
      description: 'ARN of the role CloudTrail assumes to write to CloudWatch Logs',
      optional: true,
    },
    kmsKeyId: {
      type: 'string',
      description: 'KMS key used to encrypt log files',
      optional: true,
    },
    hasCustomEventSelectors: {
      type: 'boolean',
      description: 'Whether the trail has custom event selectors',
      optional: true,
    },
    hasInsightSelectors: {
      type: 'boolean',
      description: 'Whether the trail has Insights event selectors',
      optional: true,
    },
    isOrganizationTrail: {
      type: 'boolean',
      description: 'Whether the trail is an organization trail',
      optional: true,
    },
  },
}
