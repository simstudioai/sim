import { z } from 'zod'
import { cloudtrailTrailNameOrArnSchema } from '@/lib/api/contracts/tools/aws/cloudtrail-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetTrailSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  name: cloudtrailTrailNameOrArnSchema,
})

const GetTrailResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
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
  }),
})

export const awsCloudtrailGetTrailContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/get-trail',
  body: GetTrailSchema,
  response: { mode: 'json', schema: GetTrailResponseSchema },
})
export type AwsCloudtrailGetTrailRequest = ContractBodyInput<typeof awsCloudtrailGetTrailContract>
export type AwsCloudtrailGetTrailBody = ContractBody<typeof awsCloudtrailGetTrailContract>
export type AwsCloudtrailGetTrailResponse = ContractJsonResponse<
  typeof awsCloudtrailGetTrailContract
>
