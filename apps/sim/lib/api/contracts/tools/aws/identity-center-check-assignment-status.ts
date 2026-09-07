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

export const awsIdentityCenterCheckAssignmentStatusContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/check-assignment-status',
  body: Schema,
  response: { mode: 'json', schema: identityCenterAssignmentStatusResponseSchema },
})
export type AwsIdentityCenterCheckAssignmentStatusRequest = ContractBodyInput<
  typeof awsIdentityCenterCheckAssignmentStatusContract
>
export type AwsIdentityCenterCheckAssignmentStatusBody = ContractBody<
  typeof awsIdentityCenterCheckAssignmentStatusContract
>
export type AwsIdentityCenterCheckAssignmentStatusResponse = ContractJsonResponse<
  typeof awsIdentityCenterCheckAssignmentStatusContract
>
