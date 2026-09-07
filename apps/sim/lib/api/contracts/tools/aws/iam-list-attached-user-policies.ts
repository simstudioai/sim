import { z } from 'zod'
import {
  iamConnectionShape,
  iamMarkerSchema,
  iamMaxItemsSchema,
  iamPaginationResponseShape,
  iamPolicyPathPrefixSchema,
  iamUserName64Schema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  userName: iamUserName64Schema,
  pathPrefix: iamPolicyPathPrefixSchema.optional().nullable(),
  maxItems: iamMaxItemsSchema.optional().nullable(),
  marker: iamMarkerSchema.optional().nullable(),
})

const AttachedPolicySchema = z.object({
  policyName: z.string(),
  policyArn: z.string(),
})

const ListAttachedUserPoliciesResponseSchema = z.object({
  attachedPolicies: z.array(AttachedPolicySchema),
  ...iamPaginationResponseShape,
})

export const awsIamListAttachedUserPoliciesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-attached-user-policies',
  body: Schema,
  response: { mode: 'json', schema: ListAttachedUserPoliciesResponseSchema },
})
export type AwsIamListAttachedUserPoliciesRequest = ContractBodyInput<
  typeof awsIamListAttachedUserPoliciesContract
>
export type AwsIamListAttachedUserPoliciesBody = ContractBody<
  typeof awsIamListAttachedUserPoliciesContract
>
export type AwsIamListAttachedUserPoliciesResponse = ContractJsonResponse<
  typeof awsIamListAttachedUserPoliciesContract
>
