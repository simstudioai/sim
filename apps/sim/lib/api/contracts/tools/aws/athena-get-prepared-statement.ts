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

const GetPreparedStatementSchema = athenaConnectionSchema.extend({
  statementName: athenaStatementNameSchema,
  workGroup: athenaWorkGroupSchema,
})

const GetPreparedStatementResponseSchema = z.object({
  success: z.literal(true),
  output: athenaPreparedStatementSchema,
})

export const awsAthenaGetPreparedStatementContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-prepared-statement',
  body: GetPreparedStatementSchema,
  response: { mode: 'json', schema: GetPreparedStatementResponseSchema },
})
export type AwsAthenaGetPreparedStatementRequest = ContractBodyInput<
  typeof awsAthenaGetPreparedStatementContract
>
export type AwsAthenaGetPreparedStatementBody = ContractBody<
  typeof awsAthenaGetPreparedStatementContract
>
export type AwsAthenaGetPreparedStatementResponse = ContractJsonResponse<
  typeof awsAthenaGetPreparedStatementContract
>
