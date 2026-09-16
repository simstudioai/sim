import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaDatabaseSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListDatabasesSchema = athenaConnectionSchema.extend({
  catalogName: z.string().trim().min(1, 'Data catalog name is required'),
  workGroup: z.string().optional(),
  maxResults: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(50).optional()
  ),
  nextToken: z.string().optional(),
})

const ListDatabasesResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    databases: z.array(athenaDatabaseSchema),
    nextToken: z.string().nullable(),
  }),
})

export const awsAthenaListDatabasesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/list-databases',
  body: ListDatabasesSchema,
  response: { mode: 'json', schema: ListDatabasesResponseSchema },
})
export type AwsAthenaListDatabasesRequest = ContractBodyInput<typeof awsAthenaListDatabasesContract>
export type AwsAthenaListDatabasesBody = ContractBody<typeof awsAthenaListDatabasesContract>
export type AwsAthenaListDatabasesResponse = ContractJsonResponse<
  typeof awsAthenaListDatabasesContract
>
