import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const GetQueryResultsSchema = z.object({
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
  maxQueryResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(1000).optional()
  ),
  nextToken: z.string().min(4).max(1000).optional(),
  eventDataStoreOwnerAccountId: z
    .string()
    .trim()
    .min(12)
    .max(16)
    .regex(/^\d+$/, 'Account ID must be numeric')
    .optional(),
})

const GetQueryResultsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryStatus: z.string().nullable(),
    rows: z.array(z.record(z.string(), z.string())),
    resultsCount: z.number().nullable(),
    totalResultsCount: z.number().nullable(),
    bytesScanned: z.number().nullable(),
    errorMessage: z.string().nullable(),
    nextToken: z.string().nullable(),
  }),
})

export const awsCloudtrailGetQueryResultsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/get-query-results',
  body: GetQueryResultsSchema,
  response: { mode: 'json', schema: GetQueryResultsResponseSchema },
})
export type AwsCloudtrailGetQueryResultsRequest = ContractBodyInput<
  typeof awsCloudtrailGetQueryResultsContract
>
export type AwsCloudtrailGetQueryResultsBody = ContractBody<
  typeof awsCloudtrailGetQueryResultsContract
>
export type AwsCloudtrailGetQueryResultsResponse = ContractJsonResponse<
  typeof awsCloudtrailGetQueryResultsContract
>
