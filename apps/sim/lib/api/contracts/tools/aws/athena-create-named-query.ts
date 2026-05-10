import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateNamedQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  name: z.string().min(1, 'Query name is required'),
  database: z.string().min(1, 'Database is required'),
  queryString: z.string().min(1, 'Query string is required'),
  description: z.string().optional(),
  workGroup: z.string().optional(),
})

const CreateNamedQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    namedQueryId: z.string(),
  }),
})

export const awsAthenaCreateNamedQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/create-named-query',
  body: CreateNamedQuerySchema,
  response: { mode: 'json', schema: CreateNamedQueryResponseSchema },
})
export type AwsAthenaCreateNamedQueryRequest = ContractBodyInput<
  typeof awsAthenaCreateNamedQueryContract
>
export type AwsAthenaCreateNamedQueryBody = ContractBody<typeof awsAthenaCreateNamedQueryContract>
export type AwsAthenaCreateNamedQueryResponse = ContractJsonResponse<
  typeof awsAthenaCreateNamedQueryContract
>
