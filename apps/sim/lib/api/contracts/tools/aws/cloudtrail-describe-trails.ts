import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/**
 * A trail name (3-128 chars, ASCII alphanumerics plus non-adjacent `.`, `_`, `-`,
 * starting and ending alphanumeric) or a full trail ARN. Shadow trails and
 * organization trails in another Region can only be addressed by ARN.
 * @see https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_GetTrail.html
 */
const trailNameOrArnSchema = z
  .string()
  .trim()
  .min(3, 'Trail name must be at least 3 characters')
  .max(256, 'Trail name or ARN is too long')
  .regex(
    /^(?:arn:aws[a-zA-Z0-9-]*:cloudtrail:[a-z0-9-]+:\d{12}:trail\/[\w.\-/]+|[a-zA-Z0-9](?:[._-]?[a-zA-Z0-9]+)+)$/,
    'Must be a valid trail name or trail ARN'
  )

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
  trailNameList: z
    .array(trailNameOrArnSchema)
    .max(200, 'A maximum of 200 trail names or ARNs can be described at once')
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
