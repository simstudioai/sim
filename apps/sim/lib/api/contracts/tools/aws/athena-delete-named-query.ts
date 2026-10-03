import { z } from 'zod'
import { athenaConnectionSchema } from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteNamedQuerySchema = athenaConnectionSchema.extend({
  namedQueryId: z.string().trim().min(1, 'Named query ID is required'),
})

const DeleteNamedQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    success: z.literal(true),
  }),
})

export const awsAthenaDeleteNamedQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/delete-named-query',
  body: DeleteNamedQuerySchema,
  response: { mode: 'json', schema: DeleteNamedQueryResponseSchema },
})
export type AwsAthenaDeleteNamedQueryRequest = ContractBodyInput<
  typeof awsAthenaDeleteNamedQueryContract
>
export type AwsAthenaDeleteNamedQueryBody = ContractBody<typeof awsAthenaDeleteNamedQueryContract>
export type AwsAthenaDeleteNamedQueryResponse = ContractJsonResponse<
  typeof awsAthenaDeleteNamedQueryContract
>
