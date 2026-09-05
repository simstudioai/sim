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

const GetTrailStatusSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  name: trailNameOrArnSchema,
})

const GetTrailStatusResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    isLogging: z.boolean().nullable(),
    latestDeliveryError: z.string().nullable(),
    latestDeliveryTime: z.string().nullable(),
    latestNotificationError: z.string().nullable(),
    latestNotificationTime: z.string().nullable(),
    latestCloudWatchLogsDeliveryError: z.string().nullable(),
    latestCloudWatchLogsDeliveryTime: z.string().nullable(),
    latestDigestDeliveryError: z.string().nullable(),
    latestDigestDeliveryTime: z.string().nullable(),
    startLoggingTime: z.string().nullable(),
    stopLoggingTime: z.string().nullable(),
  }),
})

export const awsCloudtrailGetTrailStatusContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/get-trail-status',
  body: GetTrailStatusSchema,
  response: { mode: 'json', schema: GetTrailStatusResponseSchema },
})
export type AwsCloudtrailGetTrailStatusRequest = ContractBodyInput<
  typeof awsCloudtrailGetTrailStatusContract
>
export type AwsCloudtrailGetTrailStatusBody = ContractBody<
  typeof awsCloudtrailGetTrailStatusContract
>
export type AwsCloudtrailGetTrailStatusResponse = ContractJsonResponse<
  typeof awsCloudtrailGetTrailStatusContract
>
