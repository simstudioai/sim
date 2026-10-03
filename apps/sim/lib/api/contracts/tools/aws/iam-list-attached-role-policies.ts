import { z } from 'zod'
import {
  iamConnectionShape,
  iamMarkerSchema,
  iamMaxItemsSchema,
  iamPaginationResponseShape,
  iamPolicyPathPrefixSchema,
  iamRoleNameSchema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  roleName: iamRoleNameSchema,
  pathPrefix: iamPolicyPathPrefixSchema.optional().nullable(),
  maxItems: iamMaxItemsSchema.optional().nullable(),
  marker: iamMarkerSchema.optional().nullable(),
})

const AttachedPolicySchema = z.object({
  policyName: z.string(),
  policyArn: z.string(),
})

const ListAttachedRolePoliciesResponseSchema = z.object({
  attachedPolicies: z.array(AttachedPolicySchema),
  ...iamPaginationResponseShape,
})

export const awsIamListAttachedRolePoliciesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-attached-role-policies',
  body: Schema,
  response: { mode: 'json', schema: ListAttachedRolePoliciesResponseSchema },
})
export type AwsIamListAttachedRolePoliciesRequest = ContractBodyInput<
  typeof awsIamListAttachedRolePoliciesContract
>
export type AwsIamListAttachedRolePoliciesBody = ContractBody<
  typeof awsIamListAttachedRolePoliciesContract
>
export type AwsIamListAttachedRolePoliciesResponse = ContractJsonResponse<
  typeof awsIamListAttachedRolePoliciesContract
>
