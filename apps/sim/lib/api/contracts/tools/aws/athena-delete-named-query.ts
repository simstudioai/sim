import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteNamedQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  namedQueryId: z.string().trim().min(1, 'Named query ID is required'),
})

const DeleteNamedQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    success: z.literal(true),
  }),
})

export const awsAthenaDeleteNamedQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/delete-named-query',
  body: DeleteNamedQuerySchema,
  response: { mode: 'json', schema: DeleteNamedQueryResponseSchema },
})
export type AwsAthenaDeleteNamedQueryRequest = ContractBodyInput<
  typeof awsAthenaDeleteNamedQueryContract
>
export type AwsAthenaDeleteNamedQueryBody = ContractBody<typeof awsAthenaDeleteNamedQueryContract>
export type AwsAthenaDeleteNamedQueryResponse = ContractJsonResponse<
  typeof awsAthenaDeleteNamedQueryContract
>
