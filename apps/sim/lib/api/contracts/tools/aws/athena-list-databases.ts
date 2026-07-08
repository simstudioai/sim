import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListDatabasesSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
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
    databases: z.array(
      z.object({
        name: z.string(),
        description: z.string().nullable(),
      })
    ),
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
