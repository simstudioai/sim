import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListQueryExecutionsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  workGroup: z.string().optional(),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(0).max(50).optional()
  ),
  nextToken: z.string().optional(),
})

const ListQueryExecutionsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryExecutionIds: z.array(z.string()),
    nextToken: z.string().nullable(),
  }),
})

export const awsAthenaListQueryExecutionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/list-query-executions',
  body: ListQueryExecutionsSchema,
  response: { mode: 'json', schema: ListQueryExecutionsResponseSchema },
})
export type AwsAthenaListQueryExecutionsRequest = ContractBodyInput<
  typeof awsAthenaListQueryExecutionsContract
>
export type AwsAthenaListQueryExecutionsBody = ContractBody<
  typeof awsAthenaListQueryExecutionsContract
>
export type AwsAthenaListQueryExecutionsResponse = ContractJsonResponse<
  typeof awsAthenaListQueryExecutionsContract
>
