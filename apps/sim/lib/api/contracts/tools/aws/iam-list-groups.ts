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

const ListGroupsResponseSchema = z.object({
  groups: z.array(
    z.object({
      groupName: z.string(),
      groupId: z.string(),
      arn: z.string(),
      path: z.string(),
      createDate: z.string().nullable(),
    })
  ),
  ...iamPaginationResponseShape,
})

export const awsIamListGroupsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-groups',
  body: Schema,
  response: { mode: 'json', schema: ListGroupsResponseSchema },
})
export type AwsIamListGroupsRequest = ContractBodyInput<typeof awsIamListGroupsContract>
export type AwsIamListGroupsBody = ContractBody<typeof awsIamListGroupsContract>
export type AwsIamListGroupsResponse = ContractJsonResponse<typeof awsIamListGroupsContract>
