import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const StopQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryExecutionId: z.string().min(1, 'Query execution ID is required'),
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
