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
  email: z.string().email('Valid email address is required'),
})

const ResponseSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
})

export const awsIdentityCenterGetUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/get-user',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterGetUserRequest = ContractBodyInput<
  typeof awsIdentityCenterGetUserContract
>
export type AwsIdentityCenterGetUserBody = ContractBody<typeof awsIdentityCenterGetUserContract>
export type AwsIdentityCenterGetUserResponse = ContractJsonResponse<
  typeof awsIdentityCenterGetUserContract
>
