import { z } from 'zod'
import {
  iamConnectionShape,
  iamMarkerSchema,
  iamMaxItemsSchema,
  iamPaginationResponseShape,
  iamPolicyPathPrefixSchema,
  iamPolicyScopeSchema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  scope: iamPolicyScopeSchema.optional().nullable(),
  onlyAttached: z.boolean().optional().nullable(),
  pathPrefix: iamPolicyPathPrefixSchema.optional().nullable(),
  maxItems: iamMaxItemsSchema.optional().nullable(),
  marker: iamMarkerSchema.optional().nullable(),
})

/**
 * `description` is deliberately absent: AWS documents it as returned by GetPolicy and
 * never by ListPolicies, so surfacing it here would always be null. Use `iam_get_policy`.
 */
const ListPoliciesResponseSchema = z.object({
  policies: z.array(
    z.object({
      policyName: z.string(),
      policyId: z.string(),
      arn: z.string(),
      path: z.string(),
      attachmentCount: z.number(),
      isAttachable: z.boolean(),
      createDate: z.string().nullable(),
      updateDate: z.string().nullable(),
      defaultVersionId: z.string().nullable(),
      permissionsBoundaryUsageCount: z.number(),
    })
  ),
  ...iamPaginationResponseShape,
})

export const awsIamListPoliciesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-policies',
  body: Schema,
  response: { mode: 'json', schema: ListPoliciesResponseSchema },
})
export type AwsIamListPoliciesRequest = ContractBodyInput<typeof awsIamListPoliciesContract>
export type AwsIamListPoliciesBody = ContractBody<typeof awsIamListPoliciesContract>
export type AwsIamListPoliciesResponse = ContractJsonResponse<typeof awsIamListPoliciesContract>
