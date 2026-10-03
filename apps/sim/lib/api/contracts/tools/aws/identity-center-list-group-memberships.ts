import { z } from 'zod'
import {
  identityCenterConnectionShape,
  identityCenterGroupIdSchema,
  identityCenterIdentityStoreIdSchema,
  identityCenterMaxResultsSchema,
  identityCenterNextTokenSchema,
} from '@/lib/api/contracts/tools/aws/identity-center-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...identityCenterConnectionShape,
  identityStoreId: identityCenterIdentityStoreIdSchema,
  groupId: identityCenterGroupIdSchema,
  maxResults: identityCenterMaxResultsSchema.optional(),
  nextToken: identityCenterNextTokenSchema.optional(),
})

const ResponseSchema = z.object({
  memberships: z.array(
    z.object({
      membershipId: z.string(),
      groupId: z.string(),
      userId: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListGroupMembershipsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-group-memberships',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListGroupMembershipsRequest = ContractBodyInput<
  typeof awsIdentityCenterListGroupMembershipsContract
>
export type AwsIdentityCenterListGroupMembershipsBody = ContractBody<
  typeof awsIdentityCenterListGroupMembershipsContract
>
export type AwsIdentityCenterListGroupMembershipsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListGroupMembershipsContract
>
