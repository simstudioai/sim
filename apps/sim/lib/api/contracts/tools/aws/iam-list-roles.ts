import { z } from 'zod'
import {
  iamConnectionShape,
  iamEntityListPathPrefixSchema,
  iamMarkerSchema,
  iamMaxItemsSchema,
  iamPaginationResponseShape,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  pathPrefix: iamEntityListPathPrefixSchema.optional().nullable(),
  maxItems: iamMaxItemsSchema.optional().nullable(),
  marker: iamMarkerSchema.optional().nullable(),
})

const ListRolesResponseSchema = z.object({
  roles: z.array(
    z.object({
      roleName: z.string(),
      roleId: z.string(),
      arn: z.string(),
      path: z.string(),
      createDate: z.string().nullable(),
      description: z.string().nullable(),
      maxSessionDuration: z.number().nullable(),
    })
  ),
  ...iamPaginationResponseShape,
})

export const awsIamListRolesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-roles',
  body: Schema,
  response: { mode: 'json', schema: ListRolesResponseSchema },
})
export type AwsIamListRolesRequest = ContractBodyInput<typeof awsIamListRolesContract>
export type AwsIamListRolesBody = ContractBody<typeof awsIamListRolesContract>
export type AwsIamListRolesResponse = ContractJsonResponse<typeof awsIamListRolesContract>
