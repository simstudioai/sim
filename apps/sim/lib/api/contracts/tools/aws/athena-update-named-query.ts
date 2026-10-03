import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaSuccessResponseSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UpdateNamedQuerySchema = athenaConnectionSchema.extend({
  namedQueryId: z.string().trim().min(1, 'Named query ID is required'),
  name: z
    .string()
    .min(1, 'Query name is required')
    .max(128, 'Query name must be at most 128 characters'),
  queryString: z.string().min(1, 'Query string is required'),
  description: z.string().max(1024, 'Description must be at most 1024 characters').optional(),
})

const UpdateNamedQueryResponseSchema = athenaSuccessResponseSchema

export const awsAthenaUpdateNamedQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/update-named-query',
  body: UpdateNamedQuerySchema,
  response: { mode: 'json', schema: UpdateNamedQueryResponseSchema },
})
export type AwsAthenaUpdateNamedQueryRequest = ContractBodyInput<
  typeof awsAthenaUpdateNamedQueryContract
>
export type AwsAthenaUpdateNamedQueryBody = ContractBody<typeof awsAthenaUpdateNamedQueryContract>
export type AwsAthenaUpdateNamedQueryResponse = ContractJsonResponse<
  typeof awsAthenaUpdateNamedQueryContract
>
