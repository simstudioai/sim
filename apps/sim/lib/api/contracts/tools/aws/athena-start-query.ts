import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const StartQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryString: z.string().min(1, 'Query string is required'),
  database: z.string().optional(),
  catalog: z.string().optional(),
  outputLocation: z.string().optional(),
  workGroup: z.string().optional(),
})

const StartQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryExecutionId: z.string(),
  }),
})

export const awsAthenaStartQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/start-query',
  body: StartQuerySchema,
  response: { mode: 'json', schema: StartQueryResponseSchema },
})
export type AwsAthenaStartQueryRequest = ContractBodyInput<typeof awsAthenaStartQueryContract>
export type AwsAthenaStartQueryBody = ContractBody<typeof awsAthenaStartQueryContract>
export type AwsAthenaStartQueryResponse = ContractJsonResponse<typeof awsAthenaStartQueryContract>
