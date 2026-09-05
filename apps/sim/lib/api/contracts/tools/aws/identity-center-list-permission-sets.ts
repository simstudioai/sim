import { z } from 'zod'
import {
  identityCenterConnectionShape,
  identityCenterInstanceArnSchema,
  identityCenterMaxResultsSchema,
  identityCenterNextTokenSchema,
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
  maxResults: identityCenterMaxResultsSchema.optional(),
  nextToken: identityCenterNextTokenSchema.optional(),
})

const ResponseSchema = z.object({
  permissionSets: z.array(
    z.object({
      permissionSetArn: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      sessionDuration: z.string().nullable(),
      createdDate: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListPermissionSetsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-permission-sets',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListPermissionSetsRequest = ContractBodyInput<
  typeof awsIdentityCenterListPermissionSetsContract
>
export type AwsIdentityCenterListPermissionSetsBody = ContractBody<
  typeof awsIdentityCenterListPermissionSetsContract
>
export type AwsIdentityCenterListPermissionSetsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListPermissionSetsContract
>
