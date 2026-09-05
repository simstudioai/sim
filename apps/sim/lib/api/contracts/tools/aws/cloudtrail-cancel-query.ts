import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const CancelQuerySchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryId: z
    .string()
    .trim()
    .regex(/^[a-f0-9-]{36}$/, 'Query ID must be a 36-character query identifier'),
  eventDataStoreOwnerAccountId: z
    .string()
    .trim()
    .min(12)
    .max(16)
    .regex(/^\d+$/, 'Account ID must be numeric')
    .optional(),
})

const CancelQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryId: z.string(),
    queryStatus: z.string().nullable(),
    eventDataStoreOwnerAccountId: z.string().nullable(),
  }),
})

export const awsCloudtrailCancelQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/cancel-query',
  body: CancelQuerySchema,
  response: { mode: 'json', schema: CancelQueryResponseSchema },
})
export type AwsCloudtrailCancelQueryRequest = ContractBodyInput<
  typeof awsCloudtrailCancelQueryContract
>
export type AwsCloudtrailCancelQueryBody = ContractBody<typeof awsCloudtrailCancelQueryContract>
export type AwsCloudtrailCancelQueryResponse = ContractJsonResponse<
  typeof awsCloudtrailCancelQueryContract
>
