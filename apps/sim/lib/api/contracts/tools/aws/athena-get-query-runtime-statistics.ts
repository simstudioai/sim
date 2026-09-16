import { z } from 'zod'
import { athenaConnectionSchema } from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetQueryRuntimeStatisticsSchema = athenaConnectionSchema.extend({
  queryExecutionId: z.string().trim().min(1, 'Query execution ID is required'),
})

const GetQueryRuntimeStatisticsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryExecutionId: z.string(),
    timeline: z.object({
      queryQueueTimeInMillis: z.number().nullable(),
      servicePreProcessingTimeInMillis: z.number().nullable(),
      queryPlanningTimeInMillis: z.number().nullable(),
      engineExecutionTimeInMillis: z.number().nullable(),
      serviceProcessingTimeInMillis: z.number().nullable(),
      totalExecutionTimeInMillis: z.number().nullable(),
    }),
    rowStatistics: z.object({
      inputRows: z.number().nullable(),
      inputBytes: z.number().nullable(),
      outputRows: z.number().nullable(),
      outputBytes: z.number().nullable(),
    }),
    outputStage: z
      .object({
        stageId: z.number().nullable(),
        state: z.string().nullable(),
        inputRows: z.number().nullable(),
        inputBytes: z.number().nullable(),
        outputRows: z.number().nullable(),
        outputBytes: z.number().nullable(),
        executionTime: z.number().nullable(),
        subStageCount: z.number(),
      })
      .nullable(),
  }),
})

export const awsAthenaGetQueryRuntimeStatisticsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-query-runtime-statistics',
  body: GetQueryRuntimeStatisticsSchema,
  response: { mode: 'json', schema: GetQueryRuntimeStatisticsResponseSchema },
})
export type AwsAthenaGetQueryRuntimeStatisticsRequest = ContractBodyInput<
  typeof awsAthenaGetQueryRuntimeStatisticsContract
>
export type AwsAthenaGetQueryRuntimeStatisticsBody = ContractBody<
  typeof awsAthenaGetQueryRuntimeStatisticsContract
>
export type AwsAthenaGetQueryRuntimeStatisticsResponse = ContractJsonResponse<
  typeof awsAthenaGetQueryRuntimeStatisticsContract
>
