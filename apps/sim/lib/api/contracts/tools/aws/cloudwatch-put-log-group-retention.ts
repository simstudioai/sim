import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/** Only these values are accepted by CloudWatch Logs PutRetentionPolicy. */
const VALID_RETENTION_DAYS = [
  1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288,
  3653,
] as const

const PutLogGroupRetentionSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  logGroupName: z.string().min(1, 'Log group name is required'),
  retentionInDays: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce
      .number()
      .refine((v) => (VALID_RETENTION_DAYS as readonly number[]).includes(v), {
        message: `retentionInDays must be one of ${VALID_RETENTION_DAYS.join(', ')}`,
      })
      .optional()
  ),
})

const PutLogGroupRetentionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    success: z.literal(true),
    logGroupName: z.string(),
    retentionInDays: z.number().nullable(),
  }),
})

export const awsCloudwatchPutLogGroupRetentionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/put-log-group-retention',
  body: PutLogGroupRetentionSchema,
  response: { mode: 'json', schema: PutLogGroupRetentionResponseSchema },
})
export type AwsCloudwatchPutLogGroupRetentionRequest = ContractBodyInput<
  typeof awsCloudwatchPutLogGroupRetentionContract
>
export type AwsCloudwatchPutLogGroupRetentionBody = ContractBody<
  typeof awsCloudwatchPutLogGroupRetentionContract
>
export type AwsCloudwatchPutLogGroupRetentionResponse = ContractJsonResponse<
  typeof awsCloudwatchPutLogGroupRetentionContract
>
