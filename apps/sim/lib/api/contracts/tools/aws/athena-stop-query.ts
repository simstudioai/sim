import { z } from 'zod'
import { athenaConnectionSchema } from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const StopQuerySchema = athenaConnectionSchema.extend({
  queryExecutionId: z.string().trim().min(1, 'Query execution ID is required'),
})

const StopQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    success: z.literal(true),
  }),
})

export const awsAthenaStopQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/stop-query',
  body: StopQuerySchema,
  response: { mode: 'json', schema: StopQueryResponseSchema },
})
export type AwsAthenaStopQueryRequest = ContractBodyInput<typeof awsAthenaStopQueryContract>
export type AwsAthenaStopQueryBody = ContractBody<typeof awsAthenaStopQueryContract>
export type AwsAthenaStopQueryResponse = ContractJsonResponse<typeof awsAthenaStopQueryContract>
