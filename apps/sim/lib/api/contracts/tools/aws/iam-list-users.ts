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

const UserSchema = z.object({
  userName: z.string(),
  userId: z.string(),
  arn: z.string(),
  path: z.string(),
  createDate: z.string().nullable(),
  passwordLastUsed: z.string().nullable(),
})

const ListUsersResponseSchema = z.object({
  users: z.array(UserSchema),
  ...iamPaginationResponseShape,
})

export const awsIamListUsersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-users',
  body: Schema,
  response: { mode: 'json', schema: ListUsersResponseSchema },
})
export type AwsIamListUsersRequest = ContractBodyInput<typeof awsIamListUsersContract>
export type AwsIamListUsersBody = ContractBody<typeof awsIamListUsersContract>
export type AwsIamListUsersResponse = ContractJsonResponse<typeof awsIamListUsersContract>
