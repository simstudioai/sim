import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaMaxResultsSchema,
  athenaNextTokenSchema,
  athenaWorkGroupSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListPreparedStatementsSchema = athenaConnectionSchema.extend({
  workGroup: athenaWorkGroupSchema,
  maxResults: athenaMaxResultsSchema(1, 50),
  nextToken: athenaNextTokenSchema,
})

const ListPreparedStatementsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    preparedStatements: z.array(
      z.object({
        statementName: z.string(),
        lastModifiedTime: z.number().nullable(),
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsAthenaListPreparedStatementsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/list-prepared-statements',
  body: ListPreparedStatementsSchema,
  response: { mode: 'json', schema: ListPreparedStatementsResponseSchema },
})
export type AwsAthenaListPreparedStatementsRequest = ContractBodyInput<
  typeof awsAthenaListPreparedStatementsContract
>
export type AwsAthenaListPreparedStatementsBody = ContractBody<
  typeof awsAthenaListPreparedStatementsContract
>
export type AwsAthenaListPreparedStatementsResponse = ContractJsonResponse<
  typeof awsAthenaListPreparedStatementsContract
>
