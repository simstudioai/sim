import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaOptionalWorkGroupSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetDataCatalogSchema = athenaConnectionSchema.extend({
  name: z.string().trim().min(1, 'Data catalog name is required'),
  workGroup: athenaOptionalWorkGroupSchema,
})

const GetDataCatalogResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    name: z.string(),
    type: z.string(),
    description: z.string().nullable(),
    status: z.string().nullable(),
    connectionType: z.string().nullable(),
    error: z.string().nullable(),
    parameters: z.record(z.string(), z.string()),
  }),
})

export const awsAthenaGetDataCatalogContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/get-data-catalog',
  body: GetDataCatalogSchema,
  response: { mode: 'json', schema: GetDataCatalogResponseSchema },
})
export type AwsAthenaGetDataCatalogRequest = ContractBodyInput<
  typeof awsAthenaGetDataCatalogContract
>
export type AwsAthenaGetDataCatalogBody = ContractBody<typeof awsAthenaGetDataCatalogContract>
export type AwsAthenaGetDataCatalogResponse = ContractJsonResponse<
  typeof awsAthenaGetDataCatalogContract
>
