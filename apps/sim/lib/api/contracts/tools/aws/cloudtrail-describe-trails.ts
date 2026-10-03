import { z } from 'zod'
import { cloudtrailTrailNameOrArnSchema } from '@/lib/api/contracts/tools/aws/cloudtrail-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const trailSchema = z.object({
  name: z.string(),
  s3BucketName: z.string().nullable(),
  s3KeyPrefix: z.string().nullable(),
  snsTopicName: z.string().nullable(),
  snsTopicArn: z.string().nullable(),
  includeGlobalServiceEvents: z.boolean().nullable(),
  isMultiRegionTrail: z.boolean().nullable(),
  homeRegion: z.string().nullable(),
  trailArn: z.string().nullable(),
  logFileValidationEnabled: z.boolean().nullable(),
  cloudWatchLogsLogGroupArn: z.string().nullable(),
  cloudWatchLogsRoleArn: z.string().nullable(),
  kmsKeyId: z.string().nullable(),
  hasCustomEventSelectors: z.boolean().nullable(),
  hasInsightSelectors: z.boolean().nullable(),
  isOrganizationTrail: z.boolean().nullable(),
})

const DescribeTrailsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  /**
   * `DescribeTrails` documents no array-member limit on `trailNameList`, so this ceiling is a
   * request-payload guard rather than an AWS constraint. It is deliberately set above anything
   * reachable: the trails-per-Region quota is 5, so naming every trail and shadow trail in an
   * account across all commercial Regions still stays well under 200.
   * @see https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_DescribeTrails.html
   * @see https://docs.aws.amazon.com/awscloudtrail/latest/userguide/WhatIsCloudTrail-Limits.html
   */
  trailNameList: z
    .array(cloudtrailTrailNameOrArnSchema)
    .max(200, 'At most 200 trail names or ARNs can be described in one request')
    .optional(),
  includeShadowTrails: z.boolean().optional(),
})

const DescribeTrailsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    trails: z.array(trailSchema),
  }),
})

export const awsCloudtrailDescribeTrailsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/describe-trails',
  body: DescribeTrailsSchema,
  response: { mode: 'json', schema: DescribeTrailsResponseSchema },
})
export type AwsCloudtrailDescribeTrailsRequest = ContractBodyInput<
  typeof awsCloudtrailDescribeTrailsContract
>
export type AwsCloudtrailDescribeTrailsBody = ContractBody<
  typeof awsCloudtrailDescribeTrailsContract
>
export type AwsCloudtrailDescribeTrailsResponse = ContractJsonResponse<
  typeof awsCloudtrailDescribeTrailsContract
>
