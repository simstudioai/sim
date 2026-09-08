import { z } from 'zod'
import {
  athenaConnectionSchema,
  athenaEngineVersionSchema,
  athenaMaxResultsSchema,
  athenaNextTokenSchema,
} from '@/lib/api/contracts/tools/aws/athena-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListWorkGroupsSchema = athenaConnectionSchema.extend({
  maxResults: athenaMaxResultsSchema(1, 50),
  nextToken: athenaNextTokenSchema,
})

const ListWorkGroupsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    workGroups: z.array(
      z.object({
        name: z.string(),
        state: z.string().nullable(),
        description: z.string().nullable(),
        creationTime: z.number().nullable(),
        engineVersion: athenaEngineVersionSchema.nullable(),
        identityCenterApplicationArn: z.string().nullable(),
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsAthenaListWorkGroupsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/athena/list-work-groups',
  body: ListWorkGroupsSchema,
  response: { mode: 'json', schema: ListWorkGroupsResponseSchema },
})
export type AwsAthenaListWorkGroupsRequest = ContractBodyInput<
  typeof awsAthenaListWorkGroupsContract
>
export type AwsAthenaListWorkGroupsBody = ContractBody<typeof awsAthenaListWorkGroupsContract>
export type AwsAthenaListWorkGroupsResponse = ContractJsonResponse<
  typeof awsAthenaListWorkGroupsContract
>
