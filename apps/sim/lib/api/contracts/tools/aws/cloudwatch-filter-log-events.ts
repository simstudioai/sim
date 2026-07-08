import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const FilterLogEventsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  logGroupName: z.string().min(1, 'Log group name is required'),
  filterPattern: z.string().max(1024).optional(),
  logStreamNamePrefix: z.string().optional(),
  startTime: z.coerce.number().int().optional(),
  endTime: z.coerce.number().int().optional(),
  startFromHead: z.boolean().optional(),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
})

const FilterLogEventsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    events: z.array(
      z.object({
        logStreamName: z.string().optional(),
        timestamp: z.number().optional(),
        message: z.string().optional(),
        ingestionTime: z.number().optional(),
      })
    ),
  }),
})

export const awsCloudwatchFilterLogEventsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudwatch/filter-log-events',
  body: FilterLogEventsSchema,
  response: { mode: 'json', schema: FilterLogEventsResponseSchema },
})
export type AwsCloudwatchFilterLogEventsRequest = ContractBodyInput<
  typeof awsCloudwatchFilterLogEventsContract
>
export type AwsCloudwatchFilterLogEventsBody = ContractBody<
  typeof awsCloudwatchFilterLogEventsContract
>
export type AwsCloudwatchFilterLogEventsResponse = ContractJsonResponse<
  typeof awsCloudwatchFilterLogEventsContract
>
