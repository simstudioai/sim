import { z } from 'zod'
import {
  identityCenterAssignmentStatusResponseSchema,
  identityCenterConnectionShape,
  identityCenterInstanceArnSchema,
  identityCenterRequestIdSchema,
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
  requestId: identityCenterRequestIdSchema,
})

export const awsIdentityCenterCheckAssignmentDeletionStatusContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/check-assignment-deletion-status',
  body: Schema,
  response: { mode: 'json', schema: identityCenterAssignmentStatusResponseSchema },
})
export type AwsIdentityCenterCheckAssignmentDeletionStatusRequest = ContractBodyInput<
  typeof awsIdentityCenterCheckAssignmentDeletionStatusContract
>
export type AwsIdentityCenterCheckAssignmentDeletionStatusBody = ContractBody<
  typeof awsIdentityCenterCheckAssignmentDeletionStatusContract
>
export type AwsIdentityCenterCheckAssignmentDeletionStatusResponse = ContractJsonResponse<
  typeof awsIdentityCenterCheckAssignmentDeletionStatusContract
>
