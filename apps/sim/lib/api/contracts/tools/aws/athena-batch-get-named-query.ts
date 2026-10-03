import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaNamedQuerySchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const BatchGetNamedQuerySchema = athenaConnectionSchema.extend({
  namedQueryIds: z
    .array(z.string().trim().min(1))
    .min(1, 'At least one named query ID is required')
    .max(50, 'A maximum of 50 named query IDs can be requested at once'),
})

const BatchGetNamedQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    namedQueries: z.array(athenaNamedQuerySchema),
    unprocessedNamedQueryIds: z.array(
      z.object({
        namedQueryId: z.string().nullable(),
        errorCode: z.string().nullable(),
        errorMessage: z.string().nullable(),
      })
    ),
  }),
})

export const awsAthenaBatchGetNamedQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/batch-get-named-query',
  body: BatchGetNamedQuerySchema,
  response: { mode: 'json', schema: BatchGetNamedQueryResponseSchema },
})
export type AwsAthenaBatchGetNamedQueryRequest = ContractBodyInput<
  typeof awsAthenaBatchGetNamedQueryContract
>
export type AwsAthenaBatchGetNamedQueryBody = ContractBody<
  typeof awsAthenaBatchGetNamedQueryContract
>
export type AwsAthenaBatchGetNamedQueryResponse = ContractJsonResponse<
  typeof awsAthenaBatchGetNamedQueryContract
>
