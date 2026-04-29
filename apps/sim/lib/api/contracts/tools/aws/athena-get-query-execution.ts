import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetQueryExecutionSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryExecutionId: z.string().min(1, 'Query execution ID is required'),
})

export const awsAthenaGetQueryExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-query-execution',
  body: GetQueryExecutionSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsAthenaGetQueryExecutionRequest = ContractBodyInput<
  typeof awsAthenaGetQueryExecutionContract
>
export type AwsAthenaGetQueryExecutionBody = ContractBody<typeof awsAthenaGetQueryExecutionContract>
export type AwsAthenaGetQueryExecutionResponse = ContractJsonResponse<
  typeof awsAthenaGetQueryExecutionContract
>
