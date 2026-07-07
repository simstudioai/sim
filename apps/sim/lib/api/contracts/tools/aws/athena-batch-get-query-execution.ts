import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const BatchGetQueryExecutionSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryExecutionIds: z
    .array(z.string().trim().min(1))
    .min(1, 'At least one query execution ID is required')
    .max(50, 'A maximum of 50 query execution IDs can be requested at once'),
})

const BatchGetQueryExecutionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryExecutions: z.array(
      z.object({
        queryExecutionId: z.string(),
        query: z.string().nullable(),
        state: z.string().nullable(),
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
      })
    ),
    unprocessedQueryExecutionIds: z.array(
      z.object({
        queryExecutionId: z.string().nullable(),
        errorCode: z.string().nullable(),
        errorMessage: z.string().nullable(),
      })
    ),
  }),
})

export const awsAthenaBatchGetQueryExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/batch-get-query-execution',
  body: BatchGetQueryExecutionSchema,
  response: { mode: 'json', schema: BatchGetQueryExecutionResponseSchema },
})
export type AwsAthenaBatchGetQueryExecutionRequest = ContractBodyInput<
  typeof awsAthenaBatchGetQueryExecutionContract
>
export type AwsAthenaBatchGetQueryExecutionBody = ContractBody<
  typeof awsAthenaBatchGetQueryExecutionContract
>
export type AwsAthenaBatchGetQueryExecutionResponse = ContractJsonResponse<
  typeof awsAthenaBatchGetQueryExecutionContract
>
