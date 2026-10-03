import { z } from 'zod'
import { athenaConnectionSchema } from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetNamedQuerySchema = athenaConnectionSchema.extend({
  namedQueryId: z.string().trim().min(1, 'Named query ID is required'),
})

const GetNamedQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    namedQueryId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    database: z.string(),
    queryString: z.string(),
    workGroup: z.string().nullable(),
  }),
})

export const awsAthenaGetNamedQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-named-query',
  body: GetNamedQuerySchema,
  response: { mode: 'json', schema: GetNamedQueryResponseSchema },
})
export type AwsAthenaGetNamedQueryRequest = ContractBodyInput<typeof awsAthenaGetNamedQueryContract>
export type AwsAthenaGetNamedQueryBody = ContractBody<typeof awsAthenaGetNamedQueryContract>
export type AwsAthenaGetNamedQueryResponse = ContractJsonResponse<
  typeof awsAthenaGetNamedQueryContract
>
