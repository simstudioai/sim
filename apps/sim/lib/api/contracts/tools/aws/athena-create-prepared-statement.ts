import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaStatementNameSchema,
  athenaSuccessResponseSchema,
  athenaWorkGroupSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreatePreparedStatementSchema = athenaConnectionSchema.extend({
  statementName: athenaStatementNameSchema,
  workGroup: athenaWorkGroupSchema,
  queryStatement: z.string().min(1, 'Query statement is required'),
  description: z
    .string()
    .min(1, 'Description cannot be empty')
    .max(1024, 'Description must be at most 1024 characters')
    .optional(),
})

const CreatePreparedStatementResponseSchema = athenaSuccessResponseSchema

export const awsAthenaCreatePreparedStatementContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/create-prepared-statement',
  body: CreatePreparedStatementSchema,
  response: { mode: 'json', schema: CreatePreparedStatementResponseSchema },
})
export type AwsAthenaCreatePreparedStatementRequest = ContractBodyInput<
  typeof awsAthenaCreatePreparedStatementContract
>
export type AwsAthenaCreatePreparedStatementBody = ContractBody<
  typeof awsAthenaCreatePreparedStatementContract
>
export type AwsAthenaCreatePreparedStatementResponse = ContractJsonResponse<
  typeof awsAthenaCreatePreparedStatementContract
>
