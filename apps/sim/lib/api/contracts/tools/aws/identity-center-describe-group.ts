import { z } from 'zod'
import {
  identityCenterConnectionShape,
  identityCenterGroupIdSchema,
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
  groupId: identityCenterGroupIdSchema,
})

const ResponseSchema = z.object({
  groupId: z.string(),
  displayName: z.string().nullable(),
  description: z.string().nullable(),
  externalIds: z.array(z.object({ issuer: z.string(), id: z.string() })),
})

export const awsIdentityCenterDescribeGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/describe-group',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterDescribeGroupRequest = ContractBodyInput<
  typeof awsIdentityCenterDescribeGroupContract
>
export type AwsIdentityCenterDescribeGroupBody = ContractBody<
  typeof awsIdentityCenterDescribeGroupContract
>
export type AwsIdentityCenterDescribeGroupResponse = ContractJsonResponse<
  typeof awsIdentityCenterDescribeGroupContract
>
