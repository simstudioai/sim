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

export const awsIdentityCenterCreateAccountAssignmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/create-account-assignment',
  body: Schema,
  response: { mode: 'json', schema: identityCenterAssignmentStatusResponseSchema },
})
export type AwsIdentityCenterCreateAccountAssignmentRequest = ContractBodyInput<
  typeof awsIdentityCenterCreateAccountAssignmentContract
>
export type AwsIdentityCenterCreateAccountAssignmentBody = ContractBody<
  typeof awsIdentityCenterCreateAccountAssignmentContract
>
export type AwsIdentityCenterCreateAccountAssignmentResponse = ContractJsonResponse<
  typeof awsIdentityCenterCreateAccountAssignmentContract
>
