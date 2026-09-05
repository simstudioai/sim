import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const DescribeQuerySchema = z
  .object({
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
      .regex(/^[a-f0-9-]{36}$/, 'Query ID must be a 36-character query identifier')
      .optional(),
    queryAlias: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/, 'Invalid query alias format')
      .optional(),
    refreshId: z
      .string()
      .trim()
      .min(10)
      .max(20)
      .regex(/^\d+$/, 'Refresh ID must be numeric')
      .optional(),
    eventDataStoreOwnerAccountId: z
      .string()
      .trim()
      .min(12)
      .max(16)
      .regex(/^\d+$/, 'Account ID must be numeric')
      .optional(),
  })
  .refine((v) => Boolean(v.queryId) !== Boolean(v.queryAlias), {
    message: 'Specify exactly one of queryId or queryAlias',
    path: ['queryId'],
  })

const DescribeQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryId: z.string().nullable(),
    queryString: z.string().nullable(),
    queryStatus: z.string().nullable(),
    errorMessage: z.string().nullable(),
    deliveryS3Uri: z.string().nullable(),
    deliveryStatus: z.string().nullable(),
    prompt: z.string().nullable(),
    eventDataStoreOwnerAccountId: z.string().nullable(),
    eventsMatched: z.number().nullable(),
    eventsScanned: z.number().nullable(),
    bytesScanned: z.number().nullable(),
    executionTimeInMillis: z.number().nullable(),
    creationTime: z.string().nullable(),
  }),
})

export const awsCloudtrailDescribeQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/describe-query',
  body: DescribeQuerySchema,
  response: { mode: 'json', schema: DescribeQueryResponseSchema },
})
export type AwsCloudtrailDescribeQueryRequest = ContractBodyInput<
  typeof awsCloudtrailDescribeQueryContract
>
export type AwsCloudtrailDescribeQueryBody = ContractBody<typeof awsCloudtrailDescribeQueryContract>
export type AwsCloudtrailDescribeQueryResponse = ContractJsonResponse<
  typeof awsCloudtrailDescribeQueryContract
>
