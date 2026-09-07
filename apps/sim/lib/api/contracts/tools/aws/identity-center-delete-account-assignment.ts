import { z } from 'zod'
import {
  identityCenterAccountIdSchema,
  identityCenterAssignmentStatusResponseSchema,
  identityCenterConnectionShape,
  identityCenterInstanceArnSchema,
  identityCenterPermissionSetArnSchema,
  identityCenterPrincipalIdSchema,
  identityCenterPrincipalTypeSchema,
} from '@/lib/api/contracts/tools/aws/identity-center-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...identityCenterConnectionShape,
  instanceArn: identityCenterInstanceArnSchema,
  accountId: identityCenterAccountIdSchema,
  permissionSetArn: identityCenterPermissionSetArnSchema,
  principalType: identityCenterPrincipalTypeSchema,
  principalId: identityCenterPrincipalIdSchema,
})

export const awsIdentityCenterDeleteAccountAssignmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/delete-account-assignment',
  body: Schema,
  response: { mode: 'json', schema: identityCenterAssignmentStatusResponseSchema },
})
export type AwsIdentityCenterDeleteAccountAssignmentRequest = ContractBodyInput<
  typeof awsIdentityCenterDeleteAccountAssignmentContract
>
export type AwsIdentityCenterDeleteAccountAssignmentBody = ContractBody<
  typeof awsIdentityCenterDeleteAccountAssignmentContract
>
export type AwsIdentityCenterDeleteAccountAssignmentResponse = ContractJsonResponse<
  typeof awsIdentityCenterDeleteAccountAssignmentContract
>
