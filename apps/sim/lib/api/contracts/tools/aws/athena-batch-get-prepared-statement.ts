import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaPreparedStatementSchema,
  athenaStatementNameSchema,
  athenaWorkGroupSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const BatchGetPreparedStatementSchema = athenaConnectionSchema.extend({
  preparedStatementNames: z
    .array(athenaStatementNameSchema)
    .min(1, 'At least one prepared statement name is required')
    .max(256, 'A maximum of 256 prepared statement names can be requested at once'),
  workGroup: athenaWorkGroupSchema,
})

const BatchGetPreparedStatementResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    preparedStatements: z.array(athenaPreparedStatementSchema),
    unprocessedPreparedStatementNames: z.array(
      z.object({
        statementName: z.string().nullable(),
        errorCode: z.string().nullable(),
        errorMessage: z.string().nullable(),
      })
    ),
  }),
})

export const awsAthenaBatchGetPreparedStatementContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/batch-get-prepared-statement',
  body: BatchGetPreparedStatementSchema,
  response: { mode: 'json', schema: BatchGetPreparedStatementResponseSchema },
})
export type AwsAthenaBatchGetPreparedStatementRequest = ContractBodyInput<
  typeof awsAthenaBatchGetPreparedStatementContract
>
export type AwsAthenaBatchGetPreparedStatementBody = ContractBody<
  typeof awsAthenaBatchGetPreparedStatementContract
>
export type AwsAthenaBatchGetPreparedStatementResponse = ContractJsonResponse<
  typeof awsAthenaBatchGetPreparedStatementContract
>
