import { z } from 'zod'
import {
  identityCenterConnectionShape,
  identityCenterInstanceArnSchema,
  identityCenterMaxResultsSchema,
  identityCenterNextTokenSchema,
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
  principalId: identityCenterPrincipalIdSchema,
  principalType: identityCenterPrincipalTypeSchema,
  maxResults: identityCenterMaxResultsSchema.optional(),
  nextToken: identityCenterNextTokenSchema.optional(),
})

const ResponseSchema = z.object({
  assignments: z.array(
    z.object({
      accountId: z.string(),
      permissionSetArn: z.string(),
      principalType: z.string(),
      principalId: z.string(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListAccountAssignmentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-account-assignments',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListAccountAssignmentsRequest = ContractBodyInput<
  typeof awsIdentityCenterListAccountAssignmentsContract
>
export type AwsIdentityCenterListAccountAssignmentsBody = ContractBody<
  typeof awsIdentityCenterListAccountAssignmentsContract
>
export type AwsIdentityCenterListAccountAssignmentsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListAccountAssignmentsContract
>
