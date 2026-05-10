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

const GetQueryExecutionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryExecutionId: z.string(),
    query: z.string(),
    state: z.string(),
    stateChangeReason: z.string().nullable(),
    statementType: z.string().nullable(),
    database: z.string().nullable(),
    catalog: z.string().nullable(),
    workGroup: z.string().nullable(),
    submissionDateTime: z.number().nullable(),
    completionDateTime: z.number().nullable(),
    dataScannedInBytes: z.number().nullable(),
    engineExecutionTimeInMillis: z.number().nullable(),
    queryPlanningTimeInMillis: z.number().nullable(),
    queryQueueTimeInMillis: z.number().nullable(),
    totalExecutionTimeInMillis: z.number().nullable(),
    outputLocation: z.string().nullable(),
  }),
})

export const awsAthenaGetQueryExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-query-execution',
  body: GetQueryExecutionSchema,
  response: { mode: 'json', schema: GetQueryExecutionResponseSchema },
})
export type AwsAthenaGetQueryExecutionRequest = ContractBodyInput<
  typeof awsAthenaGetQueryExecutionContract
>
export type AwsAthenaGetQueryExecutionBody = ContractBody<typeof awsAthenaGetQueryExecutionContract>
export type AwsAthenaGetQueryExecutionResponse = ContractJsonResponse<
  typeof awsAthenaGetQueryExecutionContract
>
