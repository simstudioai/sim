import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetQueryResultsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryExecutionId: z.string().min(1, 'Query execution ID is required'),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().max(999).optional()
  ),
  nextToken: z.string().optional(),
})

const GetQueryResultsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    columns: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
      })
    ),
    rows: z.array(z.record(z.string(), z.string())),
    nextToken: z.string().nullable(),
    updateCount: z.number().nullable(),
  }),
})

export const awsAthenaGetQueryResultsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-query-results',
  body: GetQueryResultsSchema,
  response: { mode: 'json', schema: GetQueryResultsResponseSchema },
})
export type AwsAthenaGetQueryResultsRequest = ContractBodyInput<
  typeof awsAthenaGetQueryResultsContract
>
export type AwsAthenaGetQueryResultsBody = ContractBody<typeof awsAthenaGetQueryResultsContract>
export type AwsAthenaGetQueryResultsResponse = ContractJsonResponse<
  typeof awsAthenaGetQueryResultsContract
>
