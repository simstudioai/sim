import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListNamedQueriesSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  workGroup: z.string().optional(),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(0).max(50).optional()
  ),
  nextToken: z.string().optional(),
})

const ListNamedQueriesResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    namedQueryIds: z.array(z.string()),
    nextToken: z.string().nullable(),
  }),
})

export const awsAthenaListNamedQueriesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/list-named-queries',
  body: ListNamedQueriesSchema,
  response: { mode: 'json', schema: ListNamedQueriesResponseSchema },
})
export type AwsAthenaListNamedQueriesRequest = ContractBodyInput<
  typeof awsAthenaListNamedQueriesContract
>
export type AwsAthenaListNamedQueriesBody = ContractBody<typeof awsAthenaListNamedQueriesContract>
export type AwsAthenaListNamedQueriesResponse = ContractJsonResponse<
  typeof awsAthenaListNamedQueriesContract
>
