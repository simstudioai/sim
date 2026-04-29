import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetNamedQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  namedQueryId: z.string().min(1, 'Named query ID is required'),
})

export const awsAthenaGetNamedQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-named-query',
  body: GetNamedQuerySchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsAthenaGetNamedQueryRequest = ContractBodyInput<typeof awsAthenaGetNamedQueryContract>
export type AwsAthenaGetNamedQueryBody = ContractBody<typeof awsAthenaGetNamedQueryContract>
export type AwsAthenaGetNamedQueryResponse = ContractJsonResponse<
  typeof awsAthenaGetNamedQueryContract
>
