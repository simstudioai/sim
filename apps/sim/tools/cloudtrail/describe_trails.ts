import type {
  CloudTrailDescribeTrailsParams,
  CloudTrailDescribeTrailsResponse,
} from '@/tools/cloudtrail/types'
import type { InternalToolConfig } from '@/tools/types'

export const describeTrailsTool: InternalToolConfig<
  CloudTrailDescribeTrailsParams,
  CloudTrailDescribeTrailsResponse
> = {
  id: 'cloudtrail_describe_trails',
  name: 'CloudTrail Describe Trails',
  description:
    'Retrieve the full configuration of one or more CloudTrail trails in the current Region',
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
    trailNameList: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated trail names or ARNs. Leave empty to describe every trail in the Region. Trails in another Region must be given as ARNs',
    },
    includeShadowTrails: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include shadow trails (replications of trails created in another Region, and organization trails in member accounts). Defaults to true',
    },
  },

  operation: {
    input: (params) => {
      const trailNameList = (params.trailNameList ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
      return {
        region: params.awsRegion,
        accessKeyId: params.awsAccessKeyId,
        secretAccessKey: params.awsSecretAccessKey,
        ...(trailNameList.length > 0 && { trailNameList }),
        ...(params.includeShadowTrails !== undefined && {
          includeShadowTrails: params.includeShadowTrails,
        }),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe CloudTrail trails')
    }
    return {
      success: true,
      output: {
        trails: data.output.trails ?? [],
      },
    }
  },

  outputs: {
    trails: {
      type: 'array',
      description: 'Full configuration of each matching trail',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Trail name' },
          s3BucketName: { type: 'string', description: 'S3 bucket that receives log files' },
          s3KeyPrefix: { type: 'string', description: 'S3 key prefix for delivered log files' },
          snsTopicName: { type: 'string', description: 'SNS topic notified on log delivery' },
          snsTopicArn: { type: 'string', description: 'ARN of that SNS topic' },
          includeGlobalServiceEvents: {
            type: 'boolean',
            description: 'Whether global service events are recorded',
          },
          isMultiRegionTrail: {
            type: 'boolean',
            description: 'Whether the trail records events in all Regions',
          },
          homeRegion: { type: 'string', description: 'Region in which the trail was created' },
          trailArn: { type: 'string', description: 'ARN of the trail' },
          logFileValidationEnabled: {
            type: 'boolean',
            description: 'Whether log file integrity validation is enabled',
          },
          cloudWatchLogsLogGroupArn: {
            type: 'string',
            description: 'CloudWatch Logs log group receiving events',
          },
          cloudWatchLogsRoleArn: {
            type: 'string',
            description: 'Role CloudTrail assumes to write to CloudWatch Logs',
          },
          kmsKeyId: { type: 'string', description: 'KMS key used to encrypt log files' },
          hasCustomEventSelectors: {
            type: 'boolean',
            description: 'Whether the trail has custom event selectors',
          },
          hasInsightSelectors: {
            type: 'boolean',
            description: 'Whether the trail has Insights event selectors',
          },
          isOrganizationTrail: {
            type: 'boolean',
            description: 'Whether the trail is an organization trail',
          },
        },
      },
    },
  },
}
