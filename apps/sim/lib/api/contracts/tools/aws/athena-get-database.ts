import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaDatabaseSchema,
  athenaOptionalWorkGroupSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetDatabaseSchema = athenaConnectionSchema.extend({
  catalogName: z.string().trim().min(1, 'Data catalog name is required'),
  databaseName: z.string().trim().min(1, 'Database name is required'),
  workGroup: athenaOptionalWorkGroupSchema,
})

const GetDatabaseResponseSchema = z.object({
  success: z.literal(true),
  output: athenaDatabaseSchema,
})

export const awsAthenaGetDatabaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-database',
  body: GetDatabaseSchema,
  response: { mode: 'json', schema: GetDatabaseResponseSchema },
})
export type AwsAthenaGetDatabaseRequest = ContractBodyInput<typeof awsAthenaGetDatabaseContract>
export type AwsAthenaGetDatabaseBody = ContractBody<typeof awsAthenaGetDatabaseContract>
export type AwsAthenaGetDatabaseResponse = ContractJsonResponse<typeof awsAthenaGetDatabaseContract>
