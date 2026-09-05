import { z } from 'zod'
import {
  identityCenterConnectionShape,
  identityCenterIdentityStoreIdSchema,
  identityCenterUserIdSchema,
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
  userId: identityCenterUserIdSchema,
})

const ResponseSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  userStatus: z.string().nullable(),
  title: z.string().nullable(),
  externalIds: z.array(z.object({ issuer: z.string(), id: z.string() })),
})

export const awsIdentityCenterDescribeUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/describe-user',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterDescribeUserRequest = ContractBodyInput<
  typeof awsIdentityCenterDescribeUserContract
>
export type AwsIdentityCenterDescribeUserBody = ContractBody<
  typeof awsIdentityCenterDescribeUserContract
>
export type AwsIdentityCenterDescribeUserResponse = ContractJsonResponse<
  typeof awsIdentityCenterDescribeUserContract
>
