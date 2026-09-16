import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaMaxResultsSchema,
  athenaNextTokenSchema,
  athenaOptionalWorkGroupSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListDataCatalogsSchema = athenaConnectionSchema.extend({
  workGroup: athenaOptionalWorkGroupSchema,
  maxResults: athenaMaxResultsSchema(2, 50),
  nextToken: athenaNextTokenSchema,
})

const ListDataCatalogsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    dataCatalogs: z.array(
      z.object({
        catalogName: z.string(),
        type: z.string().nullable(),
        status: z.string().nullable(),
        connectionType: z.string().nullable(),
        error: z.string().nullable(),
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsAthenaListDataCatalogsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/list-data-catalogs',
  body: ListDataCatalogsSchema,
  response: { mode: 'json', schema: ListDataCatalogsResponseSchema },
})
export type AwsAthenaListDataCatalogsRequest = ContractBodyInput<
  typeof awsAthenaListDataCatalogsContract
>
export type AwsAthenaListDataCatalogsBody = ContractBody<typeof awsAthenaListDataCatalogsContract>
export type AwsAthenaListDataCatalogsResponse = ContractJsonResponse<
  typeof awsAthenaListDataCatalogsContract
>
