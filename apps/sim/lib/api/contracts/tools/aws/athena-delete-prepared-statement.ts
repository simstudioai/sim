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

const DeletePreparedStatementSchema = athenaConnectionSchema.extend({
  statementName: athenaStatementNameSchema,
  workGroup: athenaWorkGroupSchema,
})

const DeletePreparedStatementResponseSchema = athenaSuccessResponseSchema

export const awsAthenaDeletePreparedStatementContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/delete-prepared-statement',
  body: DeletePreparedStatementSchema,
  response: { mode: 'json', schema: DeletePreparedStatementResponseSchema },
})
export type AwsAthenaDeletePreparedStatementRequest = ContractBodyInput<
  typeof awsAthenaDeletePreparedStatementContract
>
export type AwsAthenaDeletePreparedStatementBody = ContractBody<
  typeof awsAthenaDeletePreparedStatementContract
>
export type AwsAthenaDeletePreparedStatementResponse = ContractJsonResponse<
  typeof awsAthenaDeletePreparedStatementContract
>
