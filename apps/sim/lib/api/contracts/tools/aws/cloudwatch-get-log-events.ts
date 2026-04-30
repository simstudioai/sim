import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetLogEventsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  logGroupName: z.string().min(1, 'Log group name is required'),
  logStreamName: z.string().min(1, 'Log stream name is required'),
  startTime: z.coerce.number().int().optional(),
  endTime: z.coerce.number().int().optional(),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
})

const GetLogEventsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    events: z.array(
      z.object({
        timestamp: z.number().optional(),
        message: z.string().optional(),
        ingestionTime: z.number().optional(),
      })
    ),
  }),
})

export const awsCloudwatchGetLogEventsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/get-log-events',
  body: GetLogEventsSchema,
  response: { mode: 'json', schema: GetLogEventsResponseSchema },
})
export type AwsCloudwatchGetLogEventsRequest = ContractBodyInput<
  typeof awsCloudwatchGetLogEventsContract
>
export type AwsCloudwatchGetLogEventsBody = ContractBody<typeof awsCloudwatchGetLogEventsContract>
export type AwsCloudwatchGetLogEventsResponse = ContractJsonResponse<
  typeof awsCloudwatchGetLogEventsContract
>
