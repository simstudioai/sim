import { z } from 'zod'
import {
  identityCenterConnectionShape,
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
  maxResults: identityCenterMaxResultsSchema.optional(),
  nextToken: identityCenterNextTokenSchema.optional(),
})

const ResponseSchema = z.object({
  groups: z.array(
    z.object({
      groupId: z.string(),
      displayName: z.string().nullable(),
      description: z.string().nullable(),
      externalIds: z.array(z.object({ issuer: z.string(), id: z.string() })),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListGroupsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-groups',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListGroupsRequest = ContractBodyInput<
  typeof awsIdentityCenterListGroupsContract
>
export type AwsIdentityCenterListGroupsBody = ContractBody<
  typeof awsIdentityCenterListGroupsContract
>
export type AwsIdentityCenterListGroupsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListGroupsContract
>
