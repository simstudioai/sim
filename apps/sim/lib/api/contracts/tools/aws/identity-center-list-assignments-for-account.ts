import { z } from 'zod'
import {
  identityCenterAccountIdSchema,
  identityCenterConnectionShape,
  identityCenterInstanceArnSchema,
  identityCenterMaxResultsSchema,
  identityCenterNextTokenSchema,
  identityCenterPermissionSetArnSchema,
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

export const awsIdentityCenterListAssignmentsForAccountContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-assignments-for-account',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListAssignmentsForAccountRequest = ContractBodyInput<
  typeof awsIdentityCenterListAssignmentsForAccountContract
>
export type AwsIdentityCenterListAssignmentsForAccountBody = ContractBody<
  typeof awsIdentityCenterListAssignmentsForAccountContract
>
export type AwsIdentityCenterListAssignmentsForAccountResponse = ContractJsonResponse<
  typeof awsIdentityCenterListAssignmentsForAccountContract
>
