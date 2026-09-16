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

const UpdatePreparedStatementSchema = athenaConnectionSchema.extend({
  statementName: athenaStatementNameSchema,
  workGroup: athenaWorkGroupSchema,
  queryStatement: z.string().min(1, 'Query statement is required'),
  description: z
    .string()
    .min(1, 'Description cannot be empty')
    .max(1024, 'Description must be at most 1024 characters')
    .optional(),
})

const UpdatePreparedStatementResponseSchema = athenaSuccessResponseSchema

export const awsAthenaUpdatePreparedStatementContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/update-prepared-statement',
  body: UpdatePreparedStatementSchema,
  response: { mode: 'json', schema: UpdatePreparedStatementResponseSchema },
})
export type AwsAthenaUpdatePreparedStatementRequest = ContractBodyInput<
  typeof awsAthenaUpdatePreparedStatementContract
>
export type AwsAthenaUpdatePreparedStatementBody = ContractBody<
  typeof awsAthenaUpdatePreparedStatementContract
>
export type AwsAthenaUpdatePreparedStatementResponse = ContractJsonResponse<
  typeof awsAthenaUpdatePreparedStatementContract
>
