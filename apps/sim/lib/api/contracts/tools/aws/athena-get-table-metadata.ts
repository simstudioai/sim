import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaOptionalWorkGroupSchema,
  athenaTableMetadataSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetTableMetadataSchema = athenaConnectionSchema.extend({
  catalogName: z.string().trim().min(1, 'Data catalog name is required'),
  databaseName: z.string().trim().min(1, 'Database name is required'),
  tableName: z.string().trim().min(1, 'Table name is required'),
  workGroup: athenaOptionalWorkGroupSchema,
})

const GetTableMetadataResponseSchema = z.object({
  success: z.literal(true),
  output: athenaTableMetadataSchema,
})

export const awsAthenaGetTableMetadataContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-table-metadata',
  body: GetTableMetadataSchema,
  response: { mode: 'json', schema: GetTableMetadataResponseSchema },
})
export type AwsAthenaGetTableMetadataRequest = ContractBodyInput<
  typeof awsAthenaGetTableMetadataContract
>
export type AwsAthenaGetTableMetadataBody = ContractBody<typeof awsAthenaGetTableMetadataContract>
export type AwsAthenaGetTableMetadataResponse = ContractJsonResponse<
  typeof awsAthenaGetTableMetadataContract
>
