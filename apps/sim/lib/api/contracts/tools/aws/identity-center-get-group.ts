import { z } from 'zod'
import {
  identityCenterConnectionShape,
  identityCenterIdentityStoreIdSchema,
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
  displayName: z.string().min(1, 'Group display name is required').max(1024),
})

const ResponseSchema = z.object({
  groupId: z.string(),
  displayName: z.string().nullable(),
  description: z.string().nullable(),
})

export const awsIdentityCenterGetGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/get-group',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterGetGroupRequest = ContractBodyInput<
  typeof awsIdentityCenterGetGroupContract
>
export type AwsIdentityCenterGetGroupBody = ContractBody<typeof awsIdentityCenterGetGroupContract>
export type AwsIdentityCenterGetGroupResponse = ContractJsonResponse<
  typeof awsIdentityCenterGetGroupContract
>
