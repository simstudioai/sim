import { z } from 'zod'
import { athenaConnectionSchema } from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListQueryExecutionsSchema = athenaConnectionSchema.extend({
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
